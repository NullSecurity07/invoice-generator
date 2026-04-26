const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

let db;

// Function to get the database instance, creating it if it doesn't exist
function getDb() {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'database.sqlite');
    db = new Database(dbPath);
    console.log(`✅ Connected to SQLite database: ${dbPath}`);
  }
  return db;
}

// Wrapper for database queries
function query(sql, params = []) {
  const dbInstance = getDb();
  if (sql.trim().toLowerCase().startsWith('select')) {
    return dbInstance.prepare(sql).all(...params);
  } else {
    return dbInstance.prepare(sql).run(...params);
  }
}

async function initSchema() {
  const dbInstance = getDb();
  try {
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL,
        email       TEXT    NOT NULL UNIQUE,
        phone       TEXT,
        password_hash TEXT  NOT NULL,
        role        TEXT    NOT NULL DEFAULT 'trainer' CHECK(role IN ('trainer','admin','superadmin')),
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_by  INTEGER,
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reset_token TEXT,
        signature_path TEXT,
        reset_token_expires TEXT,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS trainer_profiles (
        user_id     INTEGER PRIMARY KEY,
        address     TEXT,
        pan         TEXT,
        bank_account_name TEXT,
        bank_name   TEXT,
        bank_account TEXT,
        ifsc        TEXT,
        branch      TEXT,
        updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_no      TEXT    NOT NULL UNIQUE,
        trainer_id      INTEGER NOT NULL,
        client_name     TEXT    NOT NULL DEFAULT 'Behave Like Compiler (BLC)',
        training_college TEXT,
        training_period TEXT,
        po_wo_no        TEXT,
        place_of_supply TEXT,
        subtotal        REAL NOT NULL DEFAULT 0,
        total           REAL NOT NULL DEFAULT 0,
        amount_in_words TEXT,
        tds_applicable  BOOLEAN NOT NULL DEFAULT FALSE,
        tds_amount      REAL DEFAULT 0,
        status          TEXT    NOT NULL DEFAULT 'draft'
                          CHECK(status IN ('draft','submitted','under_review','approved','processing','paid','rejected')),
        remarks         TEXT,
        trainer_signed_pdf TEXT,
        admin_signed_pdf   TEXT,
        submitted_at    TEXT,
        updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (trainer_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS invoice_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id    INTEGER NOT NULL,
        sno           INTEGER NOT NULL,
        particulars   TEXT,
        dates         TEXT,
        hours_days    TEXT,
        rate          REAL DEFAULT 0,
        qty           REAL DEFAULT 1,
        amount        REAL DEFAULT 0,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS payments (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id      INTEGER NOT NULL,
        status          TEXT,
        payment_date    TEXT,
        reference_number TEXT,
        paid_by         INTEGER,
        notes           TEXT,
        created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id),
        FOREIGN KEY (paid_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        message     TEXT    NOT NULL,
        type        TEXT    DEFAULT 'info',
        is_read     BOOLEAN NOT NULL DEFAULT FALSE,
        invoice_id  INTEGER,
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_id    INTEGER,
        action      TEXT NOT NULL,
        entity      TEXT,
        entity_id   INTEGER,
        details     TEXT,
        timestamp   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (actor_id) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS colleges (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL UNIQUE,
        created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Database schema initialized for SQLite');
  } catch (e) {
    console.error('❌ Database initialization error:', e);
    throw e;
  }
}

async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass  = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPass) {
    console.warn('[DB] ADMIN_EMAIL or ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }

  const email = adminEmail.trim().toLowerCase();
  const existing = query('SELECT id FROM users WHERE email = ?', [email]);

  if (existing.length > 0) {
    // Admin exists — never overwrite their password on restart
    console.log(`[DB] Admin already exists: ${email}`);
  } else {
    const hash = bcrypt.hashSync(adminPass, 12);
    const result = query(`
      INSERT INTO users (name, email, phone, password_hash, role, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['BLC Admin', email, null, hash, 'admin', 1]);

    query('INSERT OR IGNORE INTO trainer_profiles (user_id) VALUES (?)', [result.lastInsertRowid]);
    console.log(`[DB] Admin created: ${email}`);
  }
}

// Global initialization function
async function initialize() {
  await initSchema();
  await seedAdmin();
}

module.exports = {
  getDb,
  query,
  initialize
};