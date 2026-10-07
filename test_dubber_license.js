// license-server/test_dubber_license.js
const http = require('node:http');
const server = require('./server');
const db = require('./db');

function request(path, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `http://127.0.0.1:3000${path}`,
      {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'MySecretDesktopAppKey2026!@#',
          ...(options.headers || {})
        }
      },
      res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Starting Dubber Pro License Server Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      failed++;
    }
  }

  try {
    // 1. Health check
    const health = await request('/api/v1/health');
    assert(health.status === 200 && health.body.status === 'online', 'Health Check endpoint returns online');

    // 2. Release status check (app auto-update)
    const release = await request('/api/v1/release/status?platform=win32&arch=x64&current=2.7.0');
    assert(release.status === 200 && release.body.latestVersion === '2.7.0', 'Release update check returns 200 OK');

    // 3. Create a test Dubber Pro License Key
    const testKey = 'DUB-TEST-1234-5678-9999';
    db.raw.prepare('DELETE FROM activations WHERE license_id IN (SELECT id FROM licenses WHERE key = ?)').run(testKey);
    db.raw.prepare('DELETE FROM licenses WHERE key = ?').run(testKey);

    const newLic = db.createLicense({
      key: testKey,
      app: 'dubber-pro',
      customerName: 'Sokha Dubber',
      plan: 'Dubber Pro Lifetime',
      maxDevices: 1,
      expiresAt: null,
      features: ['khmer_voice_clone', 'ai_dubbing', 'whisper_stt']
    });
    assert(newLic && newLic.key === testKey, 'Created test Dubber license in DB');

    // 4. Test Dubber Activate with trailing slash and double slashes:
    // Dubber sends: POST /api/v1/dubber-bei-sach-voice-clone-pro/license/activate/
    const actRes = await request('/api/v1/dubber-bei-sach-voice-clone-pro/license/activate/', {
      method: 'POST'
    }, {
      license_key: testKey,
      hardware_id: 'hwid-test-machine-001',
      install_hash: 'install-test-001',
      device_label: 'DESKTOP-TEST (Windows)',
      app_version: '2.7.0'
    });

    assert(actRes.status === 200, 'Activation returns HTTP 200');
    assert(actRes.body.success === true, 'Activation returns success: true');
    assert(actRes.body.status === 'active', 'Activation returns status: "active"');
    assert(actRes.body.deviceLimit === 1, 'Activation returns deviceLimit');

    // 5. Test Dubber Verify endpoint:
    // Dubber sends: POST /api/v1/dubber-bei-sach-voice-clone-pro/license/verify/
    const verRes = await request('/api/v1/dubber-bei-sach-voice-clone-pro/license/verify/', {
      method: 'POST'
    }, {
      license_key: testKey,
      hardware_id: 'hwid-test-machine-001',
      install_hash: 'install-test-001',
      app_version: '2.7.0'
    });

    assert(verRes.status === 200, 'Verification returns HTTP 200');
    assert(verRes.body.success === true, 'Verification returns success: true');
    assert(verRes.body.status === 'active', 'Verification returns status: "active"');

    // 6. Test Double Slash from origin having trailing slash:
    // e.g. "http://localhost:3000//api/v1/dubber-bei-sach-voice-clone-pro/license/verify/"
    const doubleSlashRes = await request('//api/v1/dubber-bei-sach-voice-clone-pro/license/verify/', {
      method: 'POST'
    }, {
      license_key: testKey,
      hardware_id: 'hwid-test-machine-001'
    });
    assert(doubleSlashRes.status === 200, 'Double-slash path normalizes correctly and succeeds');

    // 7. Test Device Limit Reached (second device on 1-machine license)
    const secondDevRes = await request('/api/v1/dubber-bei-sach-voice-clone-pro/license/activate/', {
      method: 'POST'
    }, {
      license_key: testKey,
      hardware_id: 'hwid-different-machine-002',
      install_hash: 'install-test-002',
      device_label: 'LAPTOP-ANOTHER (Windows)'
    });
    assert(secondDevRes.status === 409, 'Second machine returns HTTP 409 (device limit)');
    assert(secondDevRes.body.error === 'device_already_bound', 'Second machine returns error: "device_already_bound"');

    // Clean up test key
    db.raw.prepare('DELETE FROM activations WHERE license_id IN (SELECT id FROM licenses WHERE key = ?)').run(testKey);
    db.raw.prepare('DELETE FROM licenses WHERE key = ?').run(testKey);

    console.log(`\n===============================================`);
    console.log(`🏁 Test Summary: ${passed} passed, ${failed} failed`);
    console.log(`===============================================\n`);
  } catch (err) {
    console.error('Test execution error:', err);
  } finally {
    server.close();
    process.exit(failed === 0 ? 0 : 1);
  }
}

// Give server 200ms to bind then run
setTimeout(runTests, 200);
