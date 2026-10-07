// license-server/server.js
const http = require('node:http');
const url = require('node:url');
const path = require('node:path');
const fs = require('node:fs');
const db = require('./db');
const {
  getOrGenerateKeypair,
  generateLicenseKey,
  createLicenseToken,
  verifyLicenseToken,
  verifyPassword
} = require('./cryptoUtils');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Ensure cryptographic keys exist
const keypair = getOrGenerateKeypair();

// In-memory active admin sessions (or signed tokens)
const activeSessions = new Map();

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
  });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 1e6) { // 1MB limit
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON format: ' + err.message));
      }
    });
    req.on('error', reject);
  });
}

function authenticateAdmin(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const session = activeSessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    activeSessions.delete(token);
    return null;
  }
  return session;
}

const server = http.createServer(async (req, res) => {
  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    return res.end();
  }

  let rawPath = req.url || '/';
  if (rawPath.startsWith('//')) {
    rawPath = '/' + rawPath.replace(/^\/+/, '');
  }
  const reqUrl = new URL(rawPath, `http://${req.headers.host || 'localhost'}`);
  let pathname = reqUrl.pathname.replace(/\/+/g, '/');
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  const method = req.method;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  try {
    // -------------------------------------------------------------------------
    // 1. PUBLIC CLIENT API (For Dubber Pro, Sdach Moan VIP, and SDK clients)
    // -------------------------------------------------------------------------

    // Health Check
    if (pathname === '/api/v1/health' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'online',
        service: 'Dubber & Sdach Moan License Management Server',
        version: '2.0.0',
        timestamp: new Date().toISOString()
      });
    }

    // App Update Status Check (Dubber & Plengbox desktop clients)
    if (pathname === '/api/v1/release/status' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'up-to-date',
        latestVersion: '2.7.0',
        currentVersion: reqUrl.searchParams.get('current') || '2.7.0',
        downloadPageUrl: 'http://localhost:3000'
      });
    }

    // Public Key (for offline signature checks in client software)
    if (pathname === '/api/v1/license/public-key' && method === 'GET') {
      return sendJson(res, 200, {
        algorithm: 'Ed25519',
        publicKey: keypair.publicKey
      });
    }

    // License Activation Endpoints
    const isActivateRoute = (
      pathname === '/api/v1/license/activate' ||
      pathname === '/api/v1/dubber-bei-sach-voice-clone-pro/license/activate' ||
      pathname === '/api/v1/sdach-moan-houngguo-vip-downloader/license/activate'
    );

    if (isActivateRoute && method === 'POST') {
      const body = await parseJsonBody(req);
      const cleanKey = (body.license_key || body.key || '').trim().toUpperCase();
      const deviceId = (body.hardware_id || body.deviceId || body.install_hash || '').trim();
      const deviceName = body.device_label || body.deviceName || 'Windows PC';
      const osInfo = body.app_version ? `Dubber Pro v${body.app_version}` : (body.osInfo || '');

      if (!cleanKey || !deviceId) {
        return sendJson(res, 400, {
          success: false,
          status: 'denied',
          error: 'Both license key and hardware/device ID are required',
          message: 'Both license key and hardware ID are required'
        });
      }

      const lic = db.getLicenseByKey(cleanKey);

      if (!lic) {
        db.recordAuditLog({
          action: 'activate_fail',
          licenseKey: cleanKey,
          deviceId,
          details: 'License key not found',
          ipAddress: clientIp
        });
        return sendJson(res, 404, {
          success: false,
          status: 'denied',
          error: 'invalid_key',
          message: 'That key was not accepted. Check it was copied whole from your purchase message.'
        });
      }

      if (lic.status !== 'active') {
        db.recordAuditLog({
          action: 'activate_fail',
          licenseKey: cleanKey,
          deviceId,
          details: `License status is ${lic.status}`,
          ipAddress: clientIp
        });
        return sendJson(res, 403, {
          success: false,
          status: 'denied',
          error: 'license_inactive',
          message: `This licence is ${lic.status}. Renew it to keep using Dubber.`
        });
      }

      // Check Expiration
      if (lic.expires_at && new Date(lic.expires_at).getTime() < Date.now()) {
        db.recordAuditLog({
          action: 'activate_fail',
          licenseKey: cleanKey,
          deviceId,
          details: 'License has expired',
          ipAddress: clientIp
        });
        return sendJson(res, 403, {
          success: false,
          status: 'expired',
          error: 'license_expired',
          message: `Your licence ended on ${lic.expires_at.slice(0, 10)}. Renew it and activate again.`,
          expires_at: lic.expires_at,
          expiresAt: lic.expires_at
        });
      }

      // Check Max Device Activations
      const existingActivation = lic.activations.find(a => a.device_id === deviceId);
      if (!existingActivation && lic.activations.length >= lic.max_devices) {
        db.recordAuditLog({
          action: 'activate_fail',
          licenseKey: cleanKey,
          deviceId,
          details: `Max devices reached (${lic.activations.length}/${lic.max_devices})`,
          ipAddress: clientIp
        });
        return sendJson(res, 409, {
          success: false,
          status: 'denied',
          error: 'device_already_bound',
          message: 'This key is already active on another computer. Contact support on Telegram to move it to this one.'
        });
      }

      // Register / refresh activation
      db.activateDevice(lic.id, { deviceId, deviceName, osInfo, ipAddress: clientIp });

      // Generate Cryptographically Signed Token
      const tokenPayload = {
        key: lic.key,
        app: lic.app || 'dubber-pro',
        plan: lic.plan,
        customer: lic.customer_name,
        deviceId,
        maxDevices: lic.max_devices,
        expiresAt: lic.expires_at,
        features: lic.features,
        activatedAt: new Date().toISOString(),
        issuer: 'dubber-license-server'
      };

      const token = createLicenseToken(tokenPayload, keypair.privateKey);

      db.recordAuditLog({
        action: 'activate_success',
        licenseKey: cleanKey,
        deviceId,
        details: `Activated device ${deviceName || deviceId} (${lic.app || 'dubber-pro'})`,
        ipAddress: clientIp
      });

      const nowIso = new Date().toISOString();
      return sendJson(res, 200, {
        success: true,
        status: 'active',
        valid: true,
        token,
        key: lic.key,
        app: lic.app,
        plan: lic.plan,
        customerName: lic.customer_name,
        expires_at: lic.expires_at,
        expiresAt: lic.expires_at,
        server_time: nowIso,
        serverTime: nowIso,
        features: lic.features,
        maxDevices: lic.max_devices,
        deviceLimit: lic.max_devices,
        activeDevices: lic.activations.length + (existingActivation ? 0 : 1),
        deviceCount: lic.activations.length + (existingActivation ? 0 : 1)
      });
    }

    // License Verification Endpoints (Heartbeat & Startup check)
    const isVerifyRoute = (
      pathname === '/api/v1/license/verify' ||
      pathname === '/api/v1/dubber-bei-sach-voice-clone-pro/license/verify' ||
      pathname === '/api/v1/sdach-moan-houngguo-vip-downloader/license/verify'
    );

    if (isVerifyRoute && method === 'POST') {
      const body = await parseJsonBody(req);
      const cleanKey = (body.license_key || body.key || '').trim().toUpperCase();
      const deviceId = (body.hardware_id || body.deviceId || body.install_hash || '').trim();
      const { token } = body;

      // Token-only offline verification check
      if (token && !cleanKey) {
        const tokenResult = verifyLicenseToken(token, keypair.publicKey);
        if (!tokenResult.valid) {
          return sendJson(res, 401, { success: false, status: 'denied', valid: false, error: tokenResult.error });
        }
        return sendJson(res, 200, { success: true, status: 'active', valid: true, payload: tokenResult.payload });
      }

      if (!cleanKey) {
        return sendJson(res, 400, { success: false, status: 'denied', valid: false, error: 'License key is required' });
      }

      const lic = db.getLicenseByKey(cleanKey);

      if (!lic) {
        return sendJson(res, 404, {
          success: false,
          status: 'denied',
          valid: false,
          reason: 'License not found',
          message: 'License key not found'
        });
      }

      if (lic.status !== 'active') {
        return sendJson(res, 403, {
          success: false,
          status: 'denied',
          valid: false,
          reason: `License is ${lic.status}`,
          message: `License is ${lic.status}`
        });
      }

      if (lic.expires_at && new Date(lic.expires_at).getTime() < Date.now()) {
        return sendJson(res, 403, {
          success: false,
          status: 'expired',
          valid: false,
          reason: 'License expired',
          message: 'License has expired',
          expiredAt: lic.expires_at,
          expires_at: lic.expires_at,
          expiresAt: lic.expires_at
        });
      }

      if (deviceId) {
        const isDeviceActive = lic.activations.some(a => a.device_id === deviceId);
        if (!isDeviceActive) {
          return sendJson(res, 409, {
            success: false,
            status: 'denied',
            valid: false,
            error: 'device_already_bound',
            reason: 'Device not registered for this license. Please call /activate.',
            message: 'Device not registered for this license. Please call /activate.'
          });
        }
        // Update device last seen
        db.activateDevice(lic.id, { deviceId, ipAddress: clientIp });
      }

      const nowIso = new Date().toISOString();
      return sendJson(res, 200, {
        success: true,
        status: 'active',
        valid: true,
        key: lic.key,
        app: lic.app,
        plan: lic.plan,
        customerName: lic.customer_name,
        expires_at: lic.expires_at,
        expiresAt: lic.expires_at,
        server_time: nowIso,
        serverTime: nowIso,
        features: lic.features,
        maxDevices: lic.max_devices,
        deviceLimit: lic.max_devices,
        activeDevices: lic.activations.length,
        deviceCount: lic.activations.length
      });
    }

    // License Deactivation
    if (pathname === '/api/v1/license/deactivate' && method === 'POST') {
      const body = await parseJsonBody(req);
      const { key, deviceId } = body;

      if (!key || !deviceId) {
        return sendJson(res, 400, { error: 'Both "key" and "deviceId" are required' });
      }

      const cleanKey = key.trim().toUpperCase();
      const success = db.deactivateDevice(cleanKey, deviceId);

      db.recordAuditLog({
        action: 'deactivate',
        licenseKey: cleanKey,
        deviceId,
        details: 'Device deactivated',
        ipAddress: clientIp
      });

      return sendJson(res, 200, { success, message: 'Device successfully deactivated' });
    }

    // -------------------------------------------------------------------------
    // 2. ADMIN AUTHENTICATION & DASHBOARD API
    // -------------------------------------------------------------------------

    // Admin Login
    if (pathname === '/api/v1/admin/login' && method === 'POST') {
      const body = await parseJsonBody(req);
      const { username, password } = body;

      if (!username || !password) {
        return sendJson(res, 400, { error: 'Username and password required' });
      }

      const adminUser = db.getAdminUser(username);
      if (!adminUser || !verifyPassword(password, adminUser.password_hash)) {
        return sendJson(res, 401, { error: 'Invalid username or password' });
      }

      // Generate session token (24h validity)
      const sessionToken = Buffer.from(require('node:crypto').randomBytes(32)).toString('hex');
      activeSessions.set(sessionToken, {
        username: adminUser.username,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      });

      return sendJson(res, 200, {
        token: sessionToken,
        username: adminUser.username,
        expiresIn: 86400
      });
    }

    // Require Auth for all subsequent `/api/v1/admin/*` endpoints
    if (pathname.startsWith('/api/v1/admin/')) {
      const session = authenticateAdmin(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Admin authentication required' });
      }

      // Get System Stats
      if (pathname === '/api/v1/admin/stats' && method === 'GET') {
        const stats = db.getStats();
        return sendJson(res, 200, stats);
      }

      // List Licenses
      if (pathname === '/api/v1/admin/licenses' && method === 'GET') {
        const search = reqUrl.searchParams.get('search') || '';
        const status = reqUrl.searchParams.get('status') || '';
        const plan = reqUrl.searchParams.get('plan') || '';
        const app = reqUrl.searchParams.get('app') || '';
        const limit = Number(reqUrl.searchParams.get('limit') || 50);
        const offset = Number(reqUrl.searchParams.get('offset') || 0);
        const licenses = db.getAllLicenses({ search, status, plan, app, limit, offset });
        return sendJson(res, 200, { licenses });
      }

      // Create New License
      if (pathname === '/api/v1/admin/licenses' && method === 'POST') {
        const body = await parseJsonBody(req);
        const app = body.app || 'dubber-pro';
        const defaultPrefix = app === 'sdach-moan' ? 'VIP' : 'DUB';
        const prefix = body.prefix || defaultPrefix;
        const key = body.customKey ? body.customKey.trim().toUpperCase() : generateLicenseKey(prefix);

        let expiresAt = null;
        if (body.daysValid && Number(body.daysValid) > 0) {
          const d = new Date();
          d.setDate(d.getDate() + Number(body.daysValid));
          expiresAt = d.toISOString();
        } else if (body.expiresAt) {
          expiresAt = new Date(body.expiresAt).toISOString();
        }

        const defaultPlan = app === 'sdach-moan' ? 'VIP Lifetime' : 'Dubber Pro Lifetime';
        const defaultFeatures = app === 'sdach-moan'
          ? ['downloads', 'batch_mode', 'vip_access']
          : ['khmer_voice_clone', 'ai_dubbing', 'whisper_stt', 'unlimited_export'];

        const newLicense = db.createLicense({
          key,
          app,
          customerName: body.customerName,
          customerEmail: body.customerEmail,
          plan: body.plan || defaultPlan,
          maxDevices: body.maxDevices || 1,
          expiresAt,
          features: body.features && body.features.length ? body.features : defaultFeatures,
          notes: body.notes
        });

        db.recordAuditLog({
          action: 'create_license',
          licenseKey: key,
          details: `Created license for ${body.customerName || 'Anonymous'} (${body.plan || defaultPlan}, ${app})`,
          ipAddress: clientIp
        });

        return sendJson(res, 201, { success: true, license: newLicense });
      }

      // Single License Operations
      const matchLic = pathname.match(/^\/api\/v1\/admin\/licenses\/(\d+)$/);
      if (matchLic) {
        const licenseId = Number(matchLic[1]);

        if (method === 'GET') {
          const lic = db.getLicenseById(licenseId);
          if (!lic) return sendJson(res, 404, { error: 'License not found' });
          return sendJson(res, 200, lic);
        }

        if (method === 'PATCH') {
          const body = await parseJsonBody(req);
          const updated = db.updateLicense(licenseId, body);
          return sendJson(res, 200, updated);
        }

        if (method === 'DELETE') {
          db.deleteLicense(licenseId);
          return sendJson(res, 200, { success: true });
        }
      }

      // Revoke License
      const matchRevoke = pathname.match(/^\/api\/v1\/admin\/licenses\/(\d+)\/revoke$/);
      if (matchRevoke && method === 'POST') {
        const licenseId = Number(matchRevoke[1]);
        const lic = db.getLicenseById(licenseId);
        if (!lic) return sendJson(res, 404, { error: 'License not found' });
        const body = await parseJsonBody(req);
        const updated = db.revokeLicense(lic.key, body.reason || 'Manually revoked by admin');
        return sendJson(res, 200, updated);
      }

      // Extend License
      const matchExtend = pathname.match(/^\/api\/v1\/admin\/licenses\/(\d+)\/extend$/);
      if (matchExtend && method === 'POST') {
        const licenseId = Number(matchExtend[1]);
        const body = await parseJsonBody(req);
        const days = Number(body.days) || 30;
        const updated = db.extendLicense(licenseId, days);
        return sendJson(res, 200, updated);
      }

      // Audit Logs
      if (pathname === '/api/v1/admin/logs' && method === 'GET') {
        const limit = Number(reqUrl.searchParams.get('limit') || 50);
        const logs = db.getRecentLogs(limit);
        return sendJson(res, 200, { logs });
      }

      // Change Admin Password
      if (pathname === '/api/v1/admin/change-password' && method === 'POST') {
        const body = await parseJsonBody(req);
        if (!body.newPassword || body.newPassword.length < 6) {
          return sendJson(res, 400, { error: 'New password must be at least 6 characters' });
        }
        db.updateAdminPassword(session.username, body.newPassword);
        return sendJson(res, 200, { success: true, message: 'Password updated successfully' });
      }
    }

    // -------------------------------------------------------------------------
    // 3. STATIC FILES (Admin Dashboard Web Application)
    // -------------------------------------------------------------------------
    const publicDir = path.join(__dirname, 'public');

    if (pathname === '/' || pathname === '/index.html') {
      return sendFile(res, path.join(publicDir, 'index.html'), 'text/html; charset=utf-8');
    }
    if (pathname === '/style.css') {
      return sendFile(res, path.join(publicDir, 'style.css'), 'text/css');
    }
    if (pathname === '/app.js') {
      return sendFile(res, path.join(publicDir, 'app.js'), 'application/javascript');
    }

    // 404 Fallback
    sendJson(res, 404, { error: 'Endpoint Not Found' });
  } catch (err) {
    console.error('[Server Error]', err);
    sendJson(res, 500, { error: 'Internal Server Error', message: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`🚀 Sndach Moan License Manager Server is RUNNING`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🔑 Admin Login: http://localhost:${PORT}`);
  console.log(`   Default Username: admin`);
  console.log(`   Default Password: admin123`);
  console.log(`=======================================================`);
});

module.exports = server;
