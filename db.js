// license-server/db.js
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword } = require('./cryptoUtils');

const DB_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
const DB_PATH = path.join(DB_DIR, 'licenses.db');

const db = new DatabaseSync(DB_PATH);

// Enable foreign keys and WAL mode for high concurrency
db.exec('PRAGMA foreign_keys = ON;');

// Initialize tables
db.exec(`
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  app TEXT DEFAULT 'dubber-pro', -- 'dubber-pro', 'sdach-moan', etc.
  customer_name TEXT,
  customer_email TEXT,
  plan TEXT DEFAULT 'VIP Lifetime',
  max_devices INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active', -- active, revoked, suspended
  expires_at TEXT,              -- ISO string or null for lifetime
  features TEXT DEFAULT '[]',   -- JSON array of feature strings
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_licenses_key ON licenses(key);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);

CREATE TABLE IF NOT EXISTS activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id INTEGER NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_name TEXT,
  os_info TEXT,
  ip_address TEXT,
  last_seen_at TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  UNIQUE(license_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_activations_device ON activations(device_id);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  license_key TEXT,
  device_id TEXT,
  details TEXT,
  ip_address TEXT,
  timestamp TEXT NOT NULL
);
`);

// Migration for existing tables: add app column if missing, then index
try {
  db.exec("ALTER TABLE licenses ADD COLUMN app TEXT DEFAULT 'dubber-pro';");
} catch {}
try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_licenses_app ON licenses(app);");
} catch {}

// Seed default admin if table is empty
const adminCount = db.prepare('SELECT count(*) as count FROM admin_users').get().count;
if (adminCount === 0) {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  const insertAdmin = db.prepare(
    'INSERT INTO admin_users (username, password_hash, created_at) VALUES (?, ?, ?)'
  );
  insertAdmin.run(adminUser, hashPassword(adminPass), new Date().toISOString());
  console.log(`[DB] Initialized default admin user: "${adminUser}" (Password: "${adminPass}")`);
}

// Database helper functions
const dbService = {
  raw: db,

  getLicenseByKey(key) {
    const lic = db.prepare('SELECT * FROM licenses WHERE key = ?').get(key);
    if (!lic) return null;
    const activations = db.prepare('SELECT * FROM activations WHERE license_id = ?').all(lic.id);
    return {
      ...lic,
      features: JSON.parse(lic.features || '[]'),
      activations,
      activeDevicesCount: activations.length
    };
  },

  getLicenseById(id) {
    const lic = db.prepare('SELECT * FROM licenses WHERE id = ?').get(id);
    if (!lic) return null;
    const activations = db.prepare('SELECT * FROM activations WHERE license_id = ?').all(lic.id);
    return {
      ...lic,
      features: JSON.parse(lic.features || '[]'),
      activations,
      activeDevicesCount: activations.length
    };
  },

  getAllLicenses({ search = '', status = '', plan = '', app = '', limit = 50, offset = 0 } = {}) {
    let query = `
      SELECT l.*,
        (SELECT COUNT(*) FROM activations a WHERE a.license_id = l.id) as active_devices_count
      FROM licenses l
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      query += ` AND (l.key LIKE ? OR l.customer_name LIKE ? OR l.customer_email LIKE ?)`;
      const term = `%${search}%`;
      params.push(term, term, term);
    }
    if (status) {
      query += ` AND l.status = ?`;
      params.push(status);
    }
    if (plan) {
      query += ` AND l.plan = ?`;
      params.push(plan);
    }
    if (app) {
      query += ` AND l.app = ?`;
      params.push(app);
    }

    query += ` ORDER BY l.id DESC LIMIT ? OFFSET ?`;
    params.push(Number(limit), Number(offset));

    const rows = db.prepare(query).all(...params);
    return rows.map(r => ({
      ...r,
      features: JSON.parse(r.features || '[]')
    }));
  },

  createLicense({ key, app, customerName, customerEmail, plan, maxDevices, expiresAt, features, notes }) {
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO licenses (
        key, app, customer_name, customer_email, plan, max_devices,
        status, expires_at, features, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `);

    stmt.run(
      key,
      app || 'dubber-pro',
      customerName || null,
      customerEmail || null,
      plan || 'Dubber Pro Lifetime',
      Number(maxDevices) || 1,
      expiresAt || null,
      JSON.stringify(features || []),
      notes || null,
      now,
      now
    );

    return this.getLicenseByKey(key);
  },

  updateLicense(id, { app, customerName, customerEmail, plan, maxDevices, status, expiresAt, features, notes }) {
    const now = new Date().toISOString();
    const fields = [];
    const params = [];

    if (app !== undefined) { fields.push('app = ?'); params.push(app); }
    if (customerName !== undefined) { fields.push('customer_name = ?'); params.push(customerName); }
    if (customerEmail !== undefined) { fields.push('customer_email = ?'); params.push(customerEmail); }
    if (plan !== undefined) { fields.push('plan = ?'); params.push(plan); }
    if (maxDevices !== undefined) { fields.push('max_devices = ?'); params.push(Number(maxDevices)); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (expiresAt !== undefined) { fields.push('expires_at = ?'); params.push(expiresAt); }
    if (features !== undefined) { fields.push('features = ?'); params.push(JSON.stringify(features)); }
    if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }

    if (fields.length === 0) return this.getLicenseById(id);

    fields.push('updated_at = ?');
    params.push(now);
    params.push(id);

    const query = `UPDATE licenses SET ${fields.join(', ')} WHERE id = ?`;
    db.prepare(query).run(...params);
    return this.getLicenseById(id);
  },

  revokeLicense(key, reason = 'Revoked by administrator') {
    const lic = this.getLicenseByKey(key);
    if (!lic) return null;
    const now = new Date().toISOString();
    db.prepare('UPDATE licenses SET status = ?, notes = ?, updated_at = ? WHERE id = ?')
      .run('revoked', reason, now, lic.id);
    return this.getLicenseById(lic.id);
  },

  extendLicense(id, additionalDays) {
    const lic = this.getLicenseById(id);
    if (!lic) return null;

    let base = lic.expires_at ? new Date(lic.expires_at) : new Date();
    if (base.getTime() < Date.now()) {
      base = new Date();
    }
    base.setDate(base.getDate() + Number(additionalDays));

    const newExpiry = base.toISOString();
    const now = new Date().toISOString();
    db.prepare('UPDATE licenses SET expires_at = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(newExpiry, 'active', now, id);

    return this.getLicenseById(id);
  },

  deleteLicense(id) {
    db.prepare('DELETE FROM activations WHERE license_id = ?').run(id);
    return db.prepare('DELETE FROM licenses WHERE id = ?').run(id);
  },

  activateDevice(licenseId, { deviceId, deviceName, osInfo, ipAddress }) {
    const now = new Date().toISOString();
    // Insert or update activation
    const stmt = db.prepare(`
      INSERT INTO activations (license_id, device_id, device_name, os_info, ip_address, last_seen_at, activated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(license_id, device_id) DO UPDATE SET
        device_name = excluded.device_name,
        os_info = excluded.os_info,
        ip_address = excluded.ip_address,
        last_seen_at = excluded.last_seen_at
    `);
    stmt.run(licenseId, deviceId, deviceName || 'Unknown Device', osInfo || '', ipAddress || '', now, now);
  },

  deactivateDevice(licenseKey, deviceId) {
    const lic = this.getLicenseByKey(licenseKey);
    if (!lic) return false;
    db.prepare('DELETE FROM activations WHERE license_id = ? AND device_id = ?').run(lic.id, deviceId);
    return true;
  },

  recordAuditLog({ action, licenseKey, deviceId, details, ipAddress }) {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (action, license_key, device_id, details, ip_address, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      action,
      licenseKey || null,
      deviceId || null,
      details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
      ipAddress || null,
      new Date().toISOString()
    );
  },

  getStats() {
    const total = db.prepare('SELECT count(*) as count FROM licenses').get().count;
    const active = db.prepare("SELECT count(*) as count FROM licenses WHERE status = 'active'").get().count;
    const revoked = db.prepare("SELECT count(*) as count FROM licenses WHERE status = 'revoked'").get().count;
    const totalActivations = db.prepare('SELECT count(*) as count FROM activations').get().count;
    const dubberCount = db.prepare("SELECT count(*) as count FROM licenses WHERE app = 'dubber-pro'").get().count;
    const now = new Date().toISOString();
    const expired = db.prepare(
      "SELECT count(*) as count FROM licenses WHERE expires_at IS NOT NULL AND expires_at < ?"
    ).get(now).count;

    return {
      totalLicenses: total,
      activeLicenses: active,
      revokedLicenses: revoked,
      expiredLicenses: expired,
      dubberLicenses: dubberCount,
      totalDeviceActivations: totalActivations
    };
  },

  getRecentLogs(limit = 30) {
    return db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(Number(limit));
  },

  getAdminUser(username) {
    return db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  },

  updateAdminPassword(username, newPassword) {
    const hash = hashPassword(newPassword);
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?').run(hash, username);
    return true;
  }
};

module.exports = dbService;
