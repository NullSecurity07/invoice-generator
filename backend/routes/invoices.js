const router = require('express').Router();
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const generatePDF = require('../services/pdf');
const emailService = require('../services/email');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { body } = require('express-validator');
const { validate } = require('../middleware/validator');

const isTrainer = [authenticate, requireRole('trainer', 'admin', 'superadmin')];
const trainerOnly = [authenticate, requireRole('trainer')];

const invoiceValidation = [
  body('training_college').trim().isLength({ min: 3 }).withMessage('Training college/venue name must be at least 3 characters'),
  body('training_period').trim().notEmpty().withMessage('Training period is required'),
  body('place_of_supply').trim().notEmpty().withMessage('Place of supply is required'),
  body('po_wo_no').optional().trim(),
  body('items').isArray({ min: 1 }).withMessage('At least one line item is required'),
  body('items.*.particulars').trim().isLength({ min: 3 }).withMessage('Item description must be at least 3 characters'),
  body('items.*.rate').isFloat({ gt: 0 }).withMessage('Rate must be a positive number'),
  body('items.*.qty').isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
  validate
];

// Helper: generate invoice number (SQLite uses strftime)
function nextInvoiceNo() {
  const year = new Date().getFullYear();
  const res = db.query("SELECT COUNT(*) AS c FROM invoices WHERE strftime('%Y', created_at) = ?", [String(year)]);
  const count = parseInt(res[0].c) || 0;
  return `BLC-INV-${year}-${String(count + 1).padStart(4, '0')}`;
}

// Helper: number to words (Indian format)
function toWords(num) {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
    'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function helper(n) {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' '+ones[n%10] : '');
    if (n < 1000) return ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' '+helper(n%100) : '');
    if (n < 100000) return helper(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' '+helper(n%1000) : '');
    if (n < 10000000) return helper(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' '+helper(n%100000) : '');
    return helper(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' '+helper(n%10000000) : '');
  }
  const rounded = Math.round(num);
  const paise = Math.round((num - rounded) * 100);
  let words = 'Rupees ' + (rounded === 0 ? 'Zero' : helper(rounded));
  if (paise > 0) words += ' and ' + helper(paise) + ' Paise';
  words += ' Only.';
  return words;
}

// POST /api/invoices
router.post('/', ...trainerOnly, invoiceValidation, async (req, res) => {
  const {
    training_college, training_period, po_wo_no, place_of_supply,
    remarks, items = [], status = 'draft'
  } = req.body;

  try {
    const dbInstance = db.getDb();
    const invoiceStatus = status === 'submitted' ? 'submitted' : 'draft';
    const submittedAt = status === 'submitted' ? new Date().toISOString() : null;

    let subtotal = 0;
    const processedItems = items.map(item => {
      const amount = parseFloat(item.rate) * parseFloat(item.qty);
      subtotal += amount;
      return { ...item, amount };
    });

    const amountInWords = toWords(subtotal);
    const invoiceNo = nextInvoiceNo();

    const insertAll = dbInstance.transaction(() => {
      const invRes = dbInstance.prepare(`
        INSERT INTO invoices (invoice_no, trainer_id, training_college, training_period, po_wo_no,
          place_of_supply, subtotal, total, amount_in_words, status, remarks, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        invoiceNo, req.user.id, training_college, training_period, po_wo_no || null,
        place_of_supply, subtotal, subtotal, amountInWords, invoiceStatus, remarks || null, submittedAt
      );

      const invoiceId = invRes.lastInsertRowid;

      for (const [index, item] of processedItems.entries()) {
        dbInstance.prepare(`
          INSERT INTO invoice_items (invoice_id, sno, particulars, dates, hours_days, rate, qty, amount)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          invoiceId, index + 1, item.particulars, item.dates || null, item.hours_days || null,
          parseFloat(item.rate), parseFloat(item.qty), item.amount
        );
      }

      if (invoiceStatus === 'submitted') {
        dbInstance.prepare('INSERT INTO notifications (user_id, message, type, invoice_id) VALUES (?, ?, ?, ?)')
          .run(req.user.id, `Invoice ${invoiceNo} submitted successfully.`, 'success', invoiceId);
      }

      dbInstance.prepare('INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES (?, ?, ?, ?)')
        .run(req.user.id, 'CREATE_INVOICE', 'invoices', invoiceId);

      return invoiceId;
    });

    const invoiceId = insertAll();

    if (invoiceStatus === 'submitted') {
      const admins = db.query("SELECT email FROM users WHERE role IN ('admin', 'superadmin') AND is_active = 1");
      for (const admin of admins) {
        emailService.sendNewInvoiceAlert(admin.email, invoiceNo, req.user.name, subtotal);
      }
      emailService.sendInvoiceActionAlert(invoiceNo, req.user.name, 'submitted', subtotal);
    } else {
      emailService.sendInvoiceActionAlert(invoiceNo, req.user.name, 'created', subtotal);
    }

    res.status(201).json({ message: 'Invoice created', id: invoiceId, invoice_no: invoiceNo });
  } catch (err) {
    console.error('Invoice creation error:', err);
    res.status(500).json({ error: 'Failed to create invoice. Please try again.' });
  }
});

// GET /api/invoices
router.get('/', ...isTrainer, async (req, res) => {
  try {
    const { status, from, to } = req.query;
    const isAdmin = ['admin','superadmin'].includes(req.user.role);
    let sql = `
      SELECT i.*, u.name AS trainer_name
      FROM invoices i JOIN users u ON u.id = i.trainer_id
      WHERE 1=1
    `;
    const params = [];
    if (!isAdmin) { sql += ` AND i.trainer_id = ?`; params.push(req.user.id); }
    if (status) { sql += ` AND i.status = ?`; params.push(status); }
    if (from) { sql += ` AND date(i.created_at) >= ?`; params.push(from); }
    if (to) { sql += ` AND date(i.created_at) <= ?`; params.push(to); }
    sql += ' ORDER BY i.created_at DESC';
    const result = db.query(sql, params);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/invoices/colleges
router.get('/colleges', authenticate, async (req, res) => {
  try {
    const result = db.query('SELECT * FROM colleges ORDER BY name ASC');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/invoices/stats/me  (must come before /:id to avoid conflict)
router.get('/stats/me', authenticate, async (req, res) => {
  const id = req.user.id;
  try {
    const total       = db.query("SELECT COUNT(*) AS c FROM invoices WHERE trainer_id=?", [id])[0].c;
    const pending     = db.query("SELECT COUNT(*) AS c FROM invoices WHERE trainer_id=? AND status IN ('submitted','under_review')", [id])[0].c;
    const approved    = db.query("SELECT COUNT(*) AS c FROM invoices WHERE trainer_id=? AND status='approved'", [id])[0].c;
    const paid        = db.query("SELECT COUNT(*) AS c FROM invoices WHERE trainer_id=? AND status='paid'", [id])[0].c;
    const totalEarnings = db.query("SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE trainer_id=? AND status='paid'", [id])[0].s;
    const pendingAmt  = db.query("SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE trainer_id=? AND status NOT IN ('paid','rejected','draft')", [id])[0].s;
    res.json({ total, pending, approved, paid, totalEarnings, pendingAmt });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/notifications/list
router.get('/notifications/list', authenticate, async (req, res) => {
  try {
    const result = db.query('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 20', [req.user.id]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/notifications/:id/read', authenticate, async (req, res) => {
  try {
    db.query('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/invoices/:id
router.get('/:id', ...isTrainer, async (req, res) => {
  try {
    const isAdmin = ['admin','superadmin'].includes(req.user.role);
    let sql = `
      SELECT i.*, u.name AS trainer_name, u.email AS trainer_email, u.phone AS trainer_phone,
             tp.address AS trainer_address, tp.pan,
             tp.bank_account_name, tp.bank_name, tp.bank_account, tp.ifsc, tp.branch
      FROM invoices i
      JOIN users u ON u.id = i.trainer_id
      LEFT JOIN trainer_profiles tp ON tp.user_id = i.trainer_id
      WHERE i.id = ?
    `;
    const params = [req.params.id];
    if (!isAdmin) { sql += ` AND i.trainer_id = ?`; params.push(req.user.id); }

    const invoice = db.query(sql, params)[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    invoice.items = db.query('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sno', [invoice.id]);
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

const patchInvoiceValidation = [
  body('training_college').optional().trim().isLength({ min: 3 }).withMessage('Training college/venue name must be at least 3 characters'),
  body('training_period').optional().trim().notEmpty().withMessage('Training period is required'),
  body('place_of_supply').optional().trim().notEmpty().withMessage('Place of supply is required'),
  body('po_wo_no').optional().trim(),
  body('items').optional().isArray({ min: 1 }).withMessage('At least one line item is required'),
  body('items.*.particulars').optional().trim().isLength({ min: 3 }).withMessage('Item description must be at least 3 characters'),
  body('items.*.rate').optional().isFloat({ gt: 0 }).withMessage('Rate must be a positive number'),
  body('items.*.qty').optional().isFloat({ gt: 0 }).withMessage('Quantity must be a positive number'),
  validate
];

// PATCH /api/invoices/:id
router.patch('/:id', ...trainerOnly, patchInvoiceValidation, async (req, res) => {
  try {
    const invoice = db.query('SELECT * FROM invoices WHERE id = ? AND trainer_id = ?', [req.params.id, req.user.id])[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status !== 'draft') return res.status(400).json({ error: 'Only draft invoices can be edited' });

    const { training_college, training_period, po_wo_no, place_of_supply, remarks, items } = req.body;

    const dbInstance = db.getDb();

    const updateAll = dbInstance.transaction(() => {
      let subtotal = invoice.subtotal;
      let total = invoice.total;
      let amountInWords = invoice.amount_in_words;

      if (items && items.length > 0) {
        subtotal = 0;
        dbInstance.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(invoice.id);
        for (const [index, item] of items.entries()) {
          const amt = (parseFloat(item.rate)||0) * (parseFloat(item.qty)||1);
          subtotal += amt;
          dbInstance.prepare(`
            INSERT INTO invoice_items (invoice_id, sno, particulars, dates, hours_days, rate, qty, amount)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(invoice.id, index + 1, item.particulars, item.dates || null, item.hours_days || null,
                 parseFloat(item.rate)||0, parseFloat(item.qty)||1, amt);
        }
        total = subtotal;
        amountInWords = toWords(total);
      }

      dbInstance.prepare(`
        UPDATE invoices SET
          training_college = COALESCE(?, training_college),
          training_period  = COALESCE(?, training_period),
          po_wo_no         = COALESCE(?, po_wo_no),
          place_of_supply  = COALESCE(?, place_of_supply),
          remarks          = COALESCE(?, remarks),
          subtotal = ?, total = ?, amount_in_words = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        training_college||null, training_period||null, po_wo_no||null,
        place_of_supply||null, remarks||null,
        subtotal, total, amountInWords, invoice.id
      );
    });

    updateAll();
    emailService.sendInvoiceActionAlert(invoice.invoice_no, req.user.name, 'updated');
    res.json({ message: 'Invoice updated' });
  } catch (err) {
    console.error('Invoice update error:', err);
    res.status(500).json({ error: 'Failed to update invoice.' });
  }
});

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `INV-${req.params.id}-${Date.now()}${ext}`);
  }
});
const upload = multer({ storage });

// POST /api/invoices/:id/submit
router.post('/:id/submit', ...trainerOnly, async (req, res) => {
  try {
    const invoice = db.query('SELECT * FROM invoices WHERE id = ? AND trainer_id = ?', [req.params.id, req.user.id])[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.status !== 'draft') return res.status(400).json({ error: 'Invoice already submitted' });

    db.query(`UPDATE invoices SET status='submitted', submitted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [invoice.id]);
    db.query('INSERT INTO notifications (user_id, message, type, invoice_id) VALUES (?,?,?,?)',
      [req.user.id, `Invoice ${invoice.invoice_no} submitted for review.`, 'success', invoice.id]);

    const admins = db.query("SELECT email FROM users WHERE role IN ('admin', 'superadmin') AND is_active = 1");
    for (const admin of admins) {
      emailService.sendNewInvoiceAlert(admin.email, invoice.invoice_no, req.user.name, invoice.total);
    }
    emailService.sendInvoiceActionAlert(invoice.invoice_no, req.user.name, 'submitted', invoice.total);

    res.json({ message: 'Invoice submitted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/invoices/:id/pdf
router.get('/:id/pdf', ...isTrainer, async (req, res) => {
  try {
    const isAdmin = ['admin','superadmin'].includes(req.user.role);
    let sql = `
      SELECT i.*, u.name AS trainer_name, u.email AS trainer_email, u.phone AS trainer_phone, u.signature_path,
             tp.address AS trainer_address, tp.pan,
             tp.bank_account_name, tp.bank_name, tp.bank_account, tp.ifsc, tp.branch
      FROM invoices i
      JOIN users u ON u.id = i.trainer_id
      LEFT JOIN trainer_profiles tp ON tp.user_id = i.trainer_id
      WHERE i.id = ?
    `;
    const params = [req.params.id];
    if (!isAdmin) { sql += ` AND i.trainer_id = ?`; params.push(req.user.id); }

    const invoice = db.query(sql, params)[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    invoice.items = db.query('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sno', [invoice.id]);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_no}.pdf"`);
    await generatePDF(invoice, res);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

module.exports = router;
