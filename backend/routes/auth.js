const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { authenticate } = require('../middleware/auth');

const multer = require('multer');
const fs = require('fs');
const path = require('path');
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, `SIG-${req.user.id}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 }, // 1MB limit
});

const { body } = require('express-validator');
const { validate } = require('../middleware/validator');

const loginValidation = [
  body('email').isEmail().withMessage('Enter a valid email address'),
  body('password').notEmpty().withMessage('Password is required'),
  validate
];

const forgotPasswordValidation = [
  body('email').isEmail().withMessage('Enter a valid email address'),
  validate
];

const resetPasswordValidation = [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
  validate
];

const profileValidation = [
  body('name').optional().trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters long'),
  body('phone').optional({ checkFalsy: true }).matches(/^\+?[\d\s-]{10,15}$/).withMessage('Enter a valid phone number'),
  body('pan').optional({ checkFalsy: true }).toUpperCase().matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).withMessage('Invalid PAN format (ABCDE1234F)'),
  body('ifsc').optional({ checkFalsy: true }).toUpperCase().matches(/^[A-Z]{4}0[A-Z0-9]{6}$/).withMessage('Invalid IFSC code format'),
  body('bank_account').optional({ checkFalsy: true }).isLength({ min: 9, max: 18 }).withMessage('Bank account should be 9-18 digits'),
  validate
];

const changePasswordValidation = [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters long'),
  validate
];

// POST /api/auth/login
router.post('/login', loginValidation, async (req, res) => {
  const { email, password } = req.body;
  console.log(`[API] Login attempt received for: ${email}`);
  
  try {
    const result = await db.query(
      'SELECT * FROM users WHERE email = ? AND is_active = ?',
      [email.trim().toLowerCase(), 1]
    );
    const user = result[0];

    if (!user) {
      console.warn(`[API] Login failed: User not found (${email})`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      console.warn(`[API] Login failed: Password mismatch for ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log(`[API] Login successful for: ${user.email} (Role: ${user.role})`);

    if (!process.env.JWT_SECRET) {
      console.error('[Auth Service] Critical Error: JWT_SECRET is missing.');
      return res.status(500).json({ error: 'Server configuration error.' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      maxAge: Number(process.env.JWT_EXPIRES_IN_MS) || 8 * 60 * 60 * 1000
    });

    // Log audit
    await db.query(
      'INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES (?,?,?,?)',
      [user.id, 'LOGIN', 'users', user.id]
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('[Auth Service] Login error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPasswordValidation, async (req, res) => {
  const { email } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE email = ? AND is_active = ?', [email.trim().toLowerCase(), 1]);
    const user = result[0];

    if (!user) {
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    const token = crypto.randomUUID();
    const expires = new Date(Date.now() + 3600000); // 1 hour
    await db.query('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [token, expires, user.id]);

    // Email logic (Simplified for clarity, assuming SMTP configured in Render)
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const resetLink = `${baseUrl}/reset-password.html?token=${token}`;
      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: user.email,
        subject: 'BLC Portal — Password Reset',
        html: `<p>Hello ${user.name},</p><p>Click <a href="${resetLink}">here</a> to reset your password.</p>`
      });
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', resetPasswordValidation, async (req, res) => {
  const { token, password } = req.body;
  try {
    const result = await db.query(
      'SELECT * FROM users WHERE reset_token = ? AND reset_token_expires > ?',
      [token, new Date()]
    );
    const user = result[0];

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const hash = bcrypt.hashSync(password, 12);
    await db.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
      [hash, user.id]
    );

    res.json({ message: 'Password reset successfully. Please log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const userRes = await db.query('SELECT id, name, email, phone, role, signature_path FROM users WHERE id = ?', [req.user.id]);
    const profileRes = await db.query('SELECT * FROM trainer_profiles WHERE user_id = ?', [req.user.id]);
    res.json({ ...userRes[0], profile: profileRes[0] });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/auth/profile
router.put('/profile', authenticate, profileValidation, async (req, res) => {
  const { name, phone, address, pan, bank_account_name, bank_name, bank_account, ifsc, branch } = req.body;

  try {
    if (name) {
      await db.query('UPDATE users SET name = ?, phone = ? WHERE id = ?', [name, phone || null, req.user.id]);
    }

    const existing = await db.query('SELECT user_id FROM trainer_profiles WHERE user_id = ?', [req.user.id]);
    if (existing.length > 0) {
      await db.query(`
        UPDATE trainer_profiles SET
          address = ?, pan = ?, bank_account_name = ?,
          bank_name = ?, bank_account = ?, ifsc = ?, branch = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
      `, [address, pan ? pan.toUpperCase() : null, bank_account_name, bank_name, bank_account, ifsc ? ifsc.toUpperCase() : null, branch, req.user.id]);
    } else {
      await db.query(`
        INSERT INTO trainer_profiles (user_id, address, pan, bank_account_name, bank_name, bank_account, ifsc, branch)
        VALUES (?,?,?,?,?,?,?,?)
      `, [req.user.id, address, pan, bank_account_name, bank_name, bank_account, ifsc, branch]);
    }

    res.json({ message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/auth/change-password
router.put('/change-password', authenticate, changePasswordValidation, async (req, res) => {
  const { current_password, new_password } = req.body;
  try {
    const result = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = result[0];
    if (!bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hash = bcrypt.hashSync(new_password, 12);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

const uploader = upload.single('signature');

// POST /api/auth/profile/signature
router.post('/profile/signature', authenticate, (req, res, next) => {
  uploader(req, res, async (err) => {
    if (err) return res.status(400).json({ error: `File upload error: ${err.message}` });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    try {
      const {fileTypeFromFile} = await import('file-type');
      const fileType = await fileTypeFromFile(req.file.path);
      const allowedTypes = ['image/jpeg', 'image/png'];

      if (!fileType || !allowedTypes.includes(fileType.mime)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Only .png, .jpg and .jpeg format allowed!' });
      }

      await db.query('UPDATE users SET signature_path = ? WHERE id = ?', [req.file.filename, req.user.id]);
      res.json({ message: 'Signature uploaded successfully', filename: req.file.filename });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Could not process file upload.' });
    }
  });
});

// GET /api/auth/signature-image/:filename
router.get('/signature-image/:filename', authenticate, (req, res) => {
  const filePath = path.join(__dirname, '../../uploads', req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.cookie('token', '', { expires: new Date(0), httpOnly: true, secure: true, sameSite: 'None' });
  res.status(200).json({ message: 'Logged out successfully' });
});

module.exports = router;
