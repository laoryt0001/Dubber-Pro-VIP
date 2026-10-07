// license-server/cryptoUtils.js
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const KEYS_FILE = path.join(DATA_DIR, 'keys.json');

/**
 * Ensures asymmetric Ed25519 keypair exists for cryptographic offline license verification.
 */
function getOrGenerateKeypair() {
  // Support cloud hosting via environment variables if provided
  if (process.env.ED25519_PUBLIC_KEY && process.env.ED25519_PRIVATE_KEY) {
    return {
      publicKey: process.env.ED25519_PUBLIC_KEY.replace(/\\n/g, '\n'),
      privateKey: process.env.ED25519_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(KEYS_FILE)) {
    try {
      const raw = fs.readFileSync(KEYS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.publicKey && parsed.privateKey) {
        return parsed;
      }
    } catch {
      // Re-generate if corrupt
    }
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const keys = { publicKey, privateKey, createdAt: new Date().toISOString() };
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf8');
  return keys;
}

/**
 * Generates formatted human-readable license key, e.g. VIP-A9F3-88B2-E401-9C7D
 */
function generateLicenseKey(prefix = 'VIP') {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid confusing 0/O, 1/I
  const randomChunk = (len) => {
    const bytes = crypto.randomBytes(len);
    let result = '';
    for (let i = 0; i < len; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  };
  return `${prefix.toUpperCase()}-${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
}

/**
 * Signs a payload with Ed25519 private key.
 */
function signPayload(payload, privateKeyPem) {
  const dataString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = crypto.sign(null, Buffer.from(dataString, 'utf8'), privateKeyPem);
  return signature.toString('base64');
}

/**
 * Verifies payload signature with Ed25519 public key.
 */
function verifySignature(payload, signatureBase64, publicKeyPem) {
  try {
    const dataString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const signature = Buffer.from(signatureBase64, 'base64');
    return crypto.verify(null, Buffer.from(dataString, 'utf8'), publicKeyPem, signature);
  } catch {
    return false;
  }
}

/**
 * Creates a signed compact license token (base64url payload + signature).
 */
function createLicenseToken(payload, privateKeyPem) {
  const json = JSON.stringify(payload);
  const bodyB64 = Buffer.from(json, 'utf8').toString('base64url');
  const sigB64 = crypto.sign(null, Buffer.from(bodyB64, 'utf8'), privateKeyPem).toString('base64url');
  return `${bodyB64}.${sigB64}`;
}

/**
 * Verifies a compact license token.
 */
function verifyLicenseToken(token, publicKeyPem) {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return { valid: false, error: 'Invalid token format' };
    const [bodyB64, sigB64] = parts;
    const isValid = crypto.verify(
      null,
      Buffer.from(bodyB64, 'utf8'),
      publicKeyPem,
      Buffer.from(sigB64, 'base64url')
    );
    if (!isValid) return { valid: false, error: 'Signature verification failed' };

    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
    if (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now()) {
      return { valid: false, error: 'License expired', payload };
    }
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Hashes password for admin authentication with salt (PBKDF2).
 */
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = storedHash.split(':');
  if (!salt || !originalHash) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

module.exports = {
  getOrGenerateKeypair,
  generateLicenseKey,
  signPayload,
  verifySignature,
  createLicenseToken,
  verifyLicenseToken,
  hashPassword,
  verifyPassword
};
