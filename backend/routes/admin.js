const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const emailService = require('../services/email');
const { PDFDocument, rgb } = require('pdf-lib');
const exceljs = require('exceljs');
const fs = require('fs');
const path = require('path');

const { body } = require('express-validator');
const { validate } = require('../middleware/validator');

const isAdmin = [authenticate, requireRole('admin', 'superadmin')];

// Helper: number to words
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

const userCreationValidation = [
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').isEmail().withMessage('Enter a valid email address'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role').optional({ checkFalsy: true }).isIn(['trainer', 'admin', 'superadmin']).withMessage('Invalid role'),
  body('phone').optional({ checkFalsy: true }).matches(/^\+?[\d\s-]{10,15}$/).withMessage('Invalid phone format'),
  body('pan').optional({ checkFalsy: true }).toUpperCase().matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).withMessage('Invalid PAN format'),
  body('ifsc').optional({ checkFalsy: true }).toUpperCase().matches(/^[A-Z]{4}0[A-Z0-9]{6}$/).withMessage('Invalid IFSC format'),
  validate
];

const invoiceStatusValidation = [
  body('status').isIn(['submitted','under_review','approved','processing','paid','rejected']).withMessage('Invalid status'),
  body('payment_date').if(body('status').equals('paid')).notEmpty().withMessage('Payment date is required for paid status'),
  body('reference_number').if(body('status').equals('paid')).notEmpty().withMessage('Reference number is required for paid status'),
  body('remarks').if(body('status').equals('rejected')).isLength({ min: 5 }).withMessage('A valid reason (min 5 chars) is required for rejection'),
  validate
];

// ─── USER MANAGEMENT ────────────────────────────────────────────────────────

// GET /api/admin/users
router.get('/users', ...isAdmin, async (req, res) => {
  const { role, search, is_active } = req.query;
  let sql = `SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active, u.created_at, u.signature_path,
                    tp.pan, tp.bank_account,
                    COALESCE(SUM(CASE WHEN i.status='paid' THEN i.total ELSE 0 END),0) AS total_paid,
                    COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','rejected','draft') THEN i.total ELSE 0 END),0) AS total_pending
             FROM users u
             LEFT JOIN trainer_profiles tp ON tp.user_id = u.id
             LEFT JOIN invoices i ON i.trainer_id = u.id
             WHERE 1=1`;
  const params = [];
  if (role) { sql += ` AND u.role = ?`; params.push(role); }
  if (is_active !== undefined) { sql += ` AND u.is_active = ?`; params.push(is_active === 'true' || is_active === '1' ? 1 : 0); }
  if (search) { 
    sql += ` AND (u.name LIKE ? OR u.email LIKE ?)`; 
    params.push(`%${search}%`); 
    params.push(`%${search}%`);
  }
  sql += ' GROUP BY u.id, tp.user_id ORDER BY u.created_at DESC';
  try {
    const result = await db.query(sql, params);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/admin/users/:id
router.get('/users/:id', ...isAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.name, u.email, u.phone, u.role, u.is_active, u.created_at,
             tp.address, tp.pan, tp.bank_account_name, tp.bank_name,
             tp.bank_account, tp.ifsc, tp.branch
      FROM users u
      LEFT JOIN trainer_profiles tp ON tp.user_id = u.id
      WHERE u.id = ?
    `, [req.params.id]);
    if (result.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/admin/users
router.post('/users', ...isAdmin, userCreationValidation, async (req, res) => {
  const { name, email, phone, password, role = 'trainer', address, pan, bank_account_name, bank_name, bank_account, ifsc, branch } = req.body;
  
  try {
    const existingRes = await db.query('SELECT id, is_active FROM users WHERE email = ?', [email.trim().toLowerCase()]);
    const existing = existingRes[0];
    
    if (role === 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Only super admins can create admin accounts' });
    }

    const hash = bcrypt.hashSync(password, 12);

    if (existing) {
      if (existing.is_active) {
        return res.status(409).json({ error: 'An active user with this email already exists' });
      } else {
        await db.query(
          'UPDATE users SET name = ?, phone = ?, password_hash = ?, role = ?, is_active = TRUE WHERE id = ?',
          [name.trim(), phone || null, hash, role, existing.id]
        );
        await db.query('INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES (?,?,?,?)', [req.user.id, 'REACTIVATE_USER', 'users', existing.id]);
        if (role === 'trainer') {
          await db.query('INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)', [existing.id, `Welcome back! Your account has been reactivated.`, 'info']);
          emailService.sendTrainerWelcome(email.trim().toLowerCase(), name.trim(), password);
        }
        return res.status(200).json({ message: 'Inactive user found and securely reactivated!', id: existing.id });
      }
    }

    const resUser = await db.query(`
      INSERT INTO users (name, email, phone, password_hash, role, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [name.trim(), email.trim().toLowerCase(), phone || null, hash, role, req.user.id]);
    const userId = resUser.lastInsertRowid;

    await db.query('INSERT INTO trainer_profiles (user_id, address, pan, bank_account_name, bank_name, bank_account, ifsc, branch) VALUES (?,?,?,?,?,?,?,?)',
      [userId, address || null, pan || null, bank_account_name || null, bank_name || null, bank_account || null, ifsc || null, branch || null]);

    await db.query('INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES (?,?,?,?)', [req.user.id, 'CREATE_USER', 'users', userId]);

    if (role === 'trainer') {
      await db.query('INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)', [userId, `Welcome to BLC Invoice Portal! You can now log in and submit invoices.`, 'info']);
      emailService.sendTrainerWelcome(email.trim().toLowerCase(), name.trim(), password);
    }

    res.status(201).json({ message: 'User created successfully', id: userId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /api/admin/users/:id
router.patch('/users/:id', ...isAdmin, async (req, res) => {
  const { name, phone, is_active, address, pan, bank_account_name, bank_name, bank_account, ifsc, branch } = req.body;
  try {
    const userRes = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    const user = userRes[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (name !== undefined || phone !== undefined || is_active !== undefined) {
      await db.query(`UPDATE users SET
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        is_active = COALESCE(?, is_active)
        WHERE id = ?`, [name || null, phone || null, is_active !== undefined ? (is_active === 'true' || is_active === 1 || is_active === true ? 1 : 0) : null, user.id]);
    }

    if (address !== undefined || pan !== undefined || bank_account !== undefined) {
      await db.query(`UPDATE trainer_profiles SET
        address = COALESCE(?, address),
        pan = COALESCE(?, pan),
        bank_account_name = COALESCE(?, bank_account_name),
        bank_name = COALESCE(?, bank_name),
        bank_account = COALESCE(?, bank_account),
        ifsc = COALESCE(?, ifsc),
        branch = COALESCE(?, branch),
        updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?`, [address || null, pan || null, bank_account_name || null, bank_name || null, bank_account || null, ifsc || null, branch || null, user.id]);
    }

    await db.query('INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES (?,?,?,?)', [req.user.id, 'UPDATE_USER', 'users', user.id]);
    res.json({ message: 'User updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// DELETE (deactivate) /api/admin/users/:id
router.delete('/users/:id', ...isAdmin, async (req, res) => {
  try {
    const userRes = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    const user = userRes[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.id === req.user.id) return res.status(400).json({ error: 'Cannot deactivate yourself' });

    if (user.role === 'trainer') {
      const pendingInvoices = await db.query(
        "SELECT COUNT(*) AS count FROM invoices WHERE trainer_id = ? AND status NOT IN ('paid', 'rejected')",
        [user.id]
      );
      if (pendingInvoices[0].count > 0) {
        return res.status(400).json({ error: 'Cannot deactivate trainer with pending or active invoices. Please resolve them first.' });
      }
    }

    await db.query('UPDATE users SET is_active = FALSE WHERE id = ?', [user.id]);
    await db.query('INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES (?,?,?,?)', [req.user.id, 'DEACTIVATE_USER', 'users', user.id]);
    res.json({ message: 'User deactivated' });
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/admin/users/:id/reset-password
router.post('/users/:id/reset-password', ...isAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const userRes = await db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (userRes.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userRes[0];
    const hash = bcrypt.hashSync(password, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    await db.query('INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES (?,?,?,?)', [req.user.id, 'RESET_PASSWORD', 'users', req.params.id]);
    await db.query('INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)', [user.id, 'Your password has been reset by an admin. Please log in with your new credentials.', 'info']);
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── INVOICE MANAGEMENT ─────────────────────────────────────────────────────

// GET /api/admin/invoices
router.get('/invoices', ...isAdmin, async (req, res) => {
  const { trainer_id, status, from, to, search } = req.query;
  let sql = `
    SELECT i.*, u.name AS trainer_name, u.email AS trainer_email
    FROM invoices i
    JOIN users u ON u.id = i.trainer_id
    WHERE 1=1
  `;
  const params = [];
  if (trainer_id) { sql += ` AND i.trainer_id = ?`; params.push(trainer_id); }
  if (status) { sql += ` AND i.status = ?`; params.push(status); }
  if (from) { sql += ` AND date(i.created_at) >= ?`; params.push(from); }
  if (to) { sql += ` AND date(i.created_at) <= ?`; params.push(to); }
  if (search) { 
    sql += ` AND (i.invoice_no LIKE ? OR u.name LIKE ?)`; 
    params.push(`%${search}%`); 
    params.push(`%${search}%`); 
  }
  sql += ' ORDER BY i.created_at DESC';
  try {
    const result = await db.query(sql, params);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/admin/invoices/:id
router.get('/invoices/:id', ...isAdmin, async (req, res) => {
  try {
    const resInv = await db.query(`
      SELECT i.*, u.name AS trainer_name, u.email AS trainer_email, u.phone AS trainer_phone,
             tp.address AS trainer_address, tp.pan,
             tp.bank_account_name, tp.bank_name, tp.bank_account, tp.ifsc, tp.branch
      FROM invoices i
      JOIN users u ON u.id = i.trainer_id
      LEFT JOIN trainer_profiles tp ON tp.user_id = i.trainer_id
      WHERE i.id = ?
    `, [req.params.id]);
    const invoice = resInv[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    const resItems = await db.query('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sno', [invoice.id]);
    invoice.items = resItems;
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// PATCH /api/admin/invoices/:id/status
router.patch('/invoices/:id/status', ...isAdmin, invoiceStatusValidation, async (req, res) => {
  const { status, remarks, payment_date, reference_number, apply_tds } = req.body;
  try {
    const resInv = await db.query('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    const invoice = resInv[0];
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    let tds_applicable = invoice.tds_applicable;
    let tds_amount = invoice.tds_amount;
    let total = invoice.total;
    let amount_in_words = invoice.amount_in_words;

    if (apply_tds !== undefined) {
      if (apply_tds) {
        tds_applicable = true;
        tds_amount = invoice.subtotal * 0.10;
        total = invoice.subtotal - tds_amount;
      } else {
        tds_applicable = false;
        tds_amount = 0;
        total = invoice.subtotal;
      }
      amount_in_words = toWords(total);
    }

    await db.query(`UPDATE invoices SET status = ?, remarks = COALESCE(?, remarks), tds_applicable = ?, tds_amount = ?, total = ?, amount_in_words = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, remarks || null, tds_applicable ? 1 : 0, tds_amount, total, amount_in_words, invoice.id]);

    if (status === 'paid' && (payment_date || reference_number)) {
      await db.query(`INSERT INTO payments (invoice_id, status, payment_date, reference_number, paid_by) VALUES (?,?,?,?,?)`,
        [invoice.id, 'paid', payment_date || null, reference_number || null, req.user.id]);
    }

    const notifMessages = {
      under_review: 'Your invoice is now under review by BLC.',
      approved: 'Your invoice has been approved! Payment will be processed soon.',
      processing: 'Payment for your invoice is being processed.',
      paid: 'Payment for your invoice has been completed!',
      rejected: `Your invoice has been rejected. ${remarks ? 'Reason: ' + remarks : 'Please contact admin.'}`
    };
    if (notifMessages[status]) {
      await db.query('INSERT INTO notifications (user_id, message, type, invoice_id) VALUES (?,?,?,?)',
        [invoice.trainer_id, notifMessages[status], status === 'rejected' ? 'error' : status === 'paid' ? 'success' : 'info', invoice.id]);
    }

    const resTrainer = await db.query('SELECT name, email FROM users WHERE id = ?', [invoice.trainer_id]);
    if (resTrainer.length > 0) {
      emailService.sendInvoiceStatusUpdate(resTrainer[0].email, resTrainer[0].name, invoice.invoice_no, status);
    }

    await db.query('INSERT INTO audit_log (actor_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)',
      [req.user.id, 'UPDATE_STATUS', 'invoices', invoice.id, status]);

    res.json({ message: `Invoice status updated to ${status}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/admin/invoices/:id/remarks
router.post('/invoices/:id/remarks', ...isAdmin, async (req, res) => {
  const { remarks } = req.body;
  if (!remarks) return res.status(400).json({ error: 'Remarks required' });
  try {
    await db.query(`UPDATE invoices SET remarks = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [remarks, req.params.id]);
    res.json({ message: 'Remarks added' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── STATS / DASHBOARD ───────────────────────────────────────────────────────

// GET /api/admin/stats
router.get('/stats', ...isAdmin, async (req, res) => {
  try {
    const totalTrainers = (await db.query("SELECT COUNT(*) AS c FROM users WHERE role='trainer' AND is_active=TRUE"))[0].c;
    const totalInvoices = (await db.query("SELECT COUNT(*) AS c FROM invoices"))[0].c;
    const pendingReview = (await db.query("SELECT COUNT(*) AS c FROM invoices WHERE status IN ('submitted','under_review')"))[0].c;
    const approved      = (await db.query("SELECT COUNT(*) AS c FROM invoices WHERE status='approved'"))[0].c;
    const paid          = (await db.query("SELECT COUNT(*) AS c FROM invoices WHERE status='paid'"))[0].c;
    const totalPaid     = (await db.query("SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE status='paid'"))[0].s;
    const totalPending  = (await db.query("SELECT COALESCE(SUM(total),0) AS s FROM invoices WHERE status NOT IN ('paid','rejected')"))[0].s;
    const recentInvoicesRes = await db.query(`
      SELECT i.invoice_no, i.total, i.status, i.created_at, u.name AS trainer_name
      FROM invoices i JOIN users u ON u.id = i.trainer_id
      ORDER BY i.created_at DESC LIMIT 10
    `);
    res.json({ totalTrainers, totalInvoices, pendingReview, approved, paid, totalPaid, totalPending, recentInvoices: recentInvoicesRes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
});

// GET /api/admin/reports/excel
router.get('/reports/excel', ...isAdmin, async (req, res) => {
  const { from, to, trainer_ids } = req.query;
  const workbook = new exceljs.Workbook();
  const dateStr = new Date().toISOString().split('T')[0];
  
  try {
    let trainerFilter = '';
    let invoiceFilter = '';
    const params = [];
    
    if (from) { invoiceFilter += ` AND date(i.submitted_at) >= ?`; params.push(from); }
    if (to) { invoiceFilter += ` AND date(i.submitted_at) <= ?`; params.push(to); }
    if (trainer_ids) {
      const ids = trainer_ids.split(',').map(Number);
      const placeholders = ids.map(() => `?`).join(',');
      trainerFilter += ` AND u.id IN (${placeholders})`;
      invoiceFilter += ` AND i.trainer_id IN (${placeholders})`;
      params.push(...ids);
    }

    const summaryData = (await db.query(`
      SELECT u.name, u.email,
             COUNT(i.id) AS inv_count,
             COALESCE(SUM(i.subtotal),0) AS total_billed_before_tds,
             COALESCE(SUM(i.tds_amount),0) AS total_tds_deducted,
             COALESCE(SUM(i.total),0) AS total_billed_after_tds,
             COALESCE(SUM(CASE WHEN i.status='paid' THEN i.total ELSE 0 END),0) AS total_paid_after_tds,
             COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','rejected','draft') THEN i.total ELSE 0 END),0) AS total_pending,
             MAX(i.submitted_at) AS last_active
      FROM users u
      LEFT JOIN invoices i ON i.trainer_id = u.id ${invoiceFilter}
      WHERE u.role = 'trainer' ${trainerFilter}
      GROUP BY u.id
      ORDER BY total_billed_after_tds DESC
    `, params));

    const masterInvoices = (await db.query(`
      SELECT i.invoice_no, i.submitted_at, u.name AS trainer_name,
             i.subtotal AS amount_before_tds, i.tds_amount, i.total AS amount_after_tds, i.status, 
             p.reference_number, p.payment_date, i.remarks
      FROM invoices i
      JOIN users u ON u.id = i.trainer_id
      LEFT JOIN payments p ON p.invoice_id = i.id
      WHERE i.status != 'draft' ${invoiceFilter}
      ORDER BY i.submitted_at DESC
    `, params));

    // Create a new parameter list for this query because the placeholders might be different
    const detailParams = [];
    let detailInvoiceFilter = '';
    let detailTrainerFilter = '';
    if (from) { detailInvoiceFilter += ` AND date(i.submitted_at) >= ?`; detailParams.push(from); }
    if (to) { detailInvoiceFilter += ` AND date(i.submitted_at) <= ?`; detailParams.push(to); }
    if (trainer_ids) {
      const ids = trainer_ids.split(',').map(Number);
      const placeholders = ids.map(() => `?`).join(',');
      detailTrainerFilter += ` AND i.trainer_id IN (${placeholders})`;
      detailParams.push(...ids);
    }
    
    const detailItems = (await db.query(`
      SELECT strftime('%Y-%m', i.submitted_at) AS month_key,
             strftime('%Y-%m', i.submitted_at) AS month_name,
             u.name AS trainer_name,
             i.invoice_no, i.submitted_at,
             it.particulars, it.dates, it.hours_days, it.rate, it.amount,
             i.status
      FROM invoice_items it
      JOIN invoices i ON i.id = it.invoice_id
      JOIN users u ON u.id = i.trainer_id
      WHERE i.status != 'draft' ${detailInvoiceFilter} ${detailTrainerFilter}
      ORDER BY month_key DESC, trainer_name ASC
    `, detailParams));
    
    const summarySheet = workbook.addWorksheet('Executive Summary');
    summarySheet.columns = [
      { header: 'Trainer Name', key: 'name', width: 25 },
      { header: 'Email Address', key: 'email', width: 25 },
      { header: 'Invoices', key: 'inv_count', width: 12 },
      { header: 'Before TDS (₹)', key: 'total_billed_before_tds', width: 20 },
      { header: 'TDS (₹)', key: 'total_tds_deducted', width: 15 },
      { header: 'Total Billed (₹)', key: 'total_billed_after_tds', width: 20 },
      { header: 'Total Paid (₹)', key: 'total_paid_after_tds', width: 20 },
      { header: 'Pending (₹)', key: 'total_pending', width: 20 },
      { header: 'Last Activity', key: 'last_active', width: 18 }
    ];
    summaryData.forEach(row => {
      summarySheet.addRow({
        ...row,
        last_active: row.last_active ? new Date(row.last_active).toLocaleDateString('en-IN') : '—'
      });
    });

    const auditSheet = workbook.addWorksheet('Master Audit Trail');
    auditSheet.columns = [
      { header: 'Invoice No', key: 'invoice_no', width: 20 },
      { header: 'Submitted At', key: 'submitted_at', width: 18 },
      { header: 'Trainer', key: 'trainer_name', width: 25 },
      { header: 'Before TDS (₹)', key: 'amount_before_tds', width: 20 },
      { header: 'TDS (₹)', key: 'tds_amount', width: 15 },
      { header: 'After TDS (₹)', key: 'amount_after_tds', width: 20 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Ref Number', key: 'reference_number', width: 20 },
      { header: 'Paid On', key: 'payment_date', width: 18 },
      { header: 'Admin Remarks', key: 'remarks', width: 35 }
    ];
    masterInvoices.forEach(row => {
      auditSheet.addRow({
        ...row,
        submitted_at: row.submitted_at ? new Date(row.submitted_at).toLocaleDateString('en-IN') : '—',
        payment_date: row.payment_date ? new Date(row.payment_date).toLocaleDateString('en-IN') : '—',
        status: (row.status || 'UNKNOWN').toUpperCase()
      });
    });

    const months = [...new Set(detailItems.map(it => it.month_name))].filter(Boolean);
    months.forEach(month => {
      const mSheet = workbook.addWorksheet(String(month).trim());
      mSheet.columns = [
        { header: 'Date', key: 'submitted_at', width: 15 },
        { header: 'Trainer', key: 'trainer_name', width: 25 },
        { header: 'Invoice No', key: 'invoice_no', width: 20 },
        { header: 'Description of Work', key: 'particulars', width: 45 },
        { header: 'Work Dates', key: 'dates', width: 20 },
        { header: 'Hours/Days', key: 'hours_days', width: 15 },
        { header: 'Rate (INR)', key: 'rate', width: 15 },
        { header: 'Line Total (INR)', key: 'amount', width: 18 },
        { header: 'Invoice Status', key: 'status', width: 15 }
      ];
      detailItems.filter(it => it.month_name === month).forEach(it => {
        mSheet.addRow({
          ...it,
          submitted_at: it.submitted_at ? new Date(it.submitted_at).toLocaleDateString('en-IN') : '—',
          status: (it.status || 'UNKNOWN').toUpperCase()
        });
      });
      mSheet.getRow(1).font = { bold: true };
      mSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E1F0' } };
    });

    [summarySheet, auditSheet].forEach(sheet => {
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1B2' } };
      sheet.columns.forEach(col => {
        if (col.header.includes('(₹)')) sheet.getColumn(col.key).numFmt = '#,##0.00';
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="BLC_Report_${dateStr}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// GET /api/admin/reports
router.get('/reports', ...isAdmin, async (req, res) => {
  const { type } = req.query;
  try {
    let data = [];
    if (type === 'monthly') {
      data = (await db.query(`SELECT strftime('%Y-%m', submitted_at) AS month, COUNT(*) AS count, COALESCE(SUM(total),0) AS total FROM invoices WHERE status NOT IN ('rejected','draft') GROUP BY month ORDER BY month DESC LIMIT 24`));
    } else if (type === 'trainer') {
      data = (await db.query(`SELECT u.name AS trainer_name, u.email, COUNT(i.id) AS invoice_count, COALESCE(SUM(CASE WHEN i.status='paid' THEN i.total ELSE 0 END),0) AS total_paid, COALESCE(SUM(CASE WHEN i.status NOT IN ('paid','rejected') THEN i.total ELSE 0 END),0) AS pending FROM users u LEFT JOIN invoices i ON i.trainer_id = u.id WHERE u.role = 'trainer' GROUP BY u.id, u.name, u.email ORDER BY total_paid DESC`));
    } else if (type === 'pending') {
      data = (await db.query(`SELECT i.invoice_no, i.total, i.status, i.submitted_at AS created_at, u.name AS trainer_name FROM invoices i JOIN users u ON u.id = i.trainer_id WHERE i.status NOT IN ('paid','rejected','draft') ORDER BY i.submitted_at ASC`));
    } else {
      data = (await db.query(`SELECT i.invoice_no, i.total, i.status, i.submitted_at AS created_at, u.name AS trainer_name, p.payment_date, p.reference_number FROM invoices i JOIN users u ON u.id = i.trainer_id LEFT JOIN payments p ON p.invoice_id = i.id WHERE i.status = 'paid' ORDER BY i.updated_at DESC`));
    }
    res.json({ type, data });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ─── COLLEGES MANAGEMENT ────────────────────────────────────────────────────

// GET /api/admin/colleges
router.get('/colleges', ...isAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM colleges ORDER BY name ASC');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// POST /api/admin/colleges
router.post('/colleges', ...isAdmin, async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'College name is required' });
  try {
    const result = await db.query('INSERT INTO colleges (name) VALUES (?)', [name.trim()]);
    res.status(201).json({ message: 'College added successfully', id: result.lastInsertRowid });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'A college with this name already exists' });
    res.status(500).json({ error: 'Failed to add college' });
  }
});

// DELETE /api/admin/colleges/:id
router.delete('/colleges/:id', ...isAdmin, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM colleges WHERE id = ?', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'College not found' });
    res.json({ message: 'College deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = router;