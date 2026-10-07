// license-server/licenseClient.js
/**
 * Client-side License SDK for Electron / Node.js Applications.
 * Drop this file into your application's source code (e.g. src/main/licenseClient.js).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class LicenseClient {
  /**
   * @param {Object} options
   * @param {string} options.serverUrl - URL of your license server, e.g. "http://localhost:3000" or "https://license.yourdomain.com"
   * @param {string} [options.publicKey] - Optional Ed25519 public key for offline cryptographic verification
   * @param {string} [options.storagePath] - Custom file path to store the activated license token
   */
  constructor(options = {}) {
    this.serverUrl = (options.serverUrl || 'http://localhost:3000').replace(/\/+$/, '');
    this.publicKey = options.publicKey || null;
    this.storagePath = options.storagePath || path.join(
      process.env.APPDATA || process.env.HOME || '.',
      '.sdach_moan_license.json'
    );
  }

  /**
   * Generates a persistent, privacy-preserving hardware fingerprint for this machine.
   */
  getDeviceId() {
    const rawParts = [
      os.platform(),
      os.arch(),
      os.hostname(),
      os.userInfo().username
    ];

    try {
      const cpus = os.cpus();
      if (cpus && cpus.length > 0) {
        rawParts.push(cpus[0].model);
      }
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
            rawParts.push(net.mac);
            break;
          }
        }
      }
    } catch {
      // Fallback
    }

    return crypto.createHash('sha256').update(rawParts.join('|')).digest('hex').slice(0, 32);
  }

  /**
   * Reads the locally cached license and token.
   */
  getStoredLicense() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch {
      // Ignore read errors
    }
    return null;
  }

  /**
   * Saves the license payload and token locally.
   */
  saveStoredLicense(data) {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.warn('[LicenseClient] Failed to save license cache:', err.message);
    }
  }

  /**
   * Clears the stored license file.
   */
  clearStoredLicense() {
    try {
      if (fs.existsSync(this.storagePath)) {
        fs.unlinkSync(this.storagePath);
      }
    } catch {
      // Ignore
    }
  }

  /**
   * Fetches the server's public key if not configured.
   */
  async fetchPublicKey() {
    if (this.publicKey) return this.publicKey;
    try {
      const res = await fetch(`${this.serverUrl}/api/v1/license/public-key`);
      if (res.ok) {
        const data = await res.json();
        this.publicKey = data.publicKey;
        return this.publicKey;
      }
    } catch (err) {
      // Network unreachable
    }
    return null;
  }

  /**
   * Activates a license key on this machine.
   * @param {string} licenseKey - The key entered by the user (e.g. VIP-XXXX-XXXX-XXXX-XXXX)
   */
  async activate(licenseKey) {
    const cleanKey = String(licenseKey).trim().toUpperCase();
    const deviceId = this.getDeviceId();
    const deviceName = `${os.hostname()} (${os.userInfo().username})`;
    const osInfo = `${os.type()} ${os.release()} ${os.arch()}`;

    try {
      const res = await fetch(`${this.serverUrl}/api/v1/license/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: cleanKey,
          deviceId,
          deviceName,
          osInfo
        })
      });

      const data = await res.json();
      if (!res.ok) {
        return {
          valid: false,
          error: data.error || `Activation failed with status ${res.status}`
        };
      }

      // Save token locally
      const licenseRecord = {
        key: cleanKey,
        token: data.token,
        plan: data.plan,
        customerName: data.customerName,
        expiresAt: data.expiresAt,
        features: data.features,
        deviceId,
        savedAt: new Date().toISOString()
      };
      this.saveStoredLicense(licenseRecord);

      return {
        valid: true,
        key: cleanKey,
        plan: data.plan,
        customerName: data.customerName,
        expiresAt: data.expiresAt,
        features: data.features,
        token: data.token
      };
    } catch (err) {
      return {
        valid: false,
        error: `Could not reach license server at ${this.serverUrl}: ${err.message}`
      };
    }
  }

  /**
   * Verifies current license status.
   * Tries online verification first. If server is offline, verifies cached cryptographic token offline.
   */
  async verify() {
    const stored = this.getStoredLicense();
    if (!stored || !stored.key) {
      return { valid: false, error: 'No license installed. Please activate.' };
    }

    const deviceId = this.getDeviceId();

    // 1. Try online verification
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

      const res = await fetch(`${this.serverUrl}/api/v1/license/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: stored.key, deviceId }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data.valid) {
          // Refresh local cache with latest expiration / plan
          stored.plan = data.plan;
          stored.expiresAt = data.expiresAt;
          stored.features = data.features;
          this.saveStoredLicense(stored);

          return {
            valid: true,
            online: true,
            key: stored.key,
            plan: data.plan,
            expiresAt: data.expiresAt,
            features: data.features
          };
        } else {
          return {
            valid: false,
            online: true,
            error: data.reason || 'License is no longer valid'
          };
        }
      }
    } catch {
      // Server unreachable, fallback to offline verification below
    }

    // 2. Offline cryptographic token verification (Grace Period)
    if (stored.token) {
      await this.fetchPublicKey();
      if (this.publicKey) {
        const offlineCheck = this.verifyOfflineToken(stored.token, this.publicKey);
        if (offlineCheck.valid) {
          return {
            valid: true,
            online: false,
            key: stored.key,
            plan: offlineCheck.payload.plan,
            expiresAt: offlineCheck.payload.expiresAt,
            features: offlineCheck.payload.features || [],
            warning: 'Operating in offline mode. Verified with local signature.'
          };
        } else {
          return {
            valid: false,
            online: false,
            error: offlineCheck.error || 'Offline signature check failed'
          };
        }
      }
    }

    return {
      valid: false,
      error: 'Cannot connect to license server and offline verification unavailable.'
    };
  }

  /**
   * Offline cryptographic token validation using Ed25519 public key.
   */
  verifyOfflineToken(token, publicKeyPem) {
    try {
      const parts = token.split('.');
      if (parts.length !== 2) return { valid: false, error: 'Malformed token' };

      const [bodyB64, sigB64] = parts;
      const isValid = crypto.verify(
        null,
        Buffer.from(bodyB64, 'utf8'),
        publicKeyPem,
        Buffer.from(sigB64, 'base64url')
      );

      if (!isValid) return { valid: false, error: 'Signature is invalid' };

      const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));

      if (payload.expiresAt && new Date(payload.expiresAt).getTime() < Date.now()) {
        return { valid: false, error: 'License expired', payload };
      }

      if (payload.deviceId && payload.deviceId !== this.getDeviceId()) {
        return { valid: false, error: 'Token is bound to a different machine' };
      }

      return { valid: true, payload };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  /**
   * Deactivates license from current machine.
   */
  async deactivate() {
    const stored = this.getStoredLicense();
    if (!stored || !stored.key) {
      this.clearStoredLicense();
      return { success: true };
    }

    const deviceId = this.getDeviceId();

    try {
      await fetch(`${this.serverUrl}/api/v1/license/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: stored.key, deviceId })
      });
    } catch {
      // Ignore if server unreachable
    }

    this.clearStoredLicense();
    return { success: true };
  }

  /**
   * Helper to check if a feature is enabled.
   */
  hasFeature(featureName) {
    const stored = this.getStoredLicense();
    if (!stored || !Array.isArray(stored.features)) return false;
    return stored.features.includes(featureName);
  }
}

module.exports = { LicenseClient };
