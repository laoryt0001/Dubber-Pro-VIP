const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(`http://localhost:3000${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:3000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
  });
}

async function run() {
  console.log('1. Health check:');
  const health = await get('/api/v1/health');
  console.log('Health:', health);

  console.log('\n2. Release update status:');
  const update = await get('/api/v1/release/status?app=dubber-pro&version=2.7.0');
  console.log('Update:', update);

  console.log('\n3. Activate Dubber Pro key:');
  const activate = await post('/api/v1/dubber-bei-sach-voice-clone-pro/license/activate/', {
    license_key: 'DUB-RLNM-JDST-WC9V-MKLM',
    hardware_id: 'HWID-CLIENT-001',
    device_label: 'Studio-PC',
    install_hash: 'HASH-001',
    app_version: '2.7.0'
  });
  console.log('Activate response:', activate);

  console.log('\n4. Verify Dubber Pro key:');
  const verify = await post('/api/v1/dubber-bei-sach-voice-clone-pro/license/verify/', {
    license_key: 'DUB-RLNM-JDST-WC9V-MKLM',
    hardware_id: 'HWID-CLIENT-001',
    device_label: 'Studio-PC',
    install_hash: 'HASH-001',
    app_version: '2.7.0'
  });
  console.log('Verify response:', verify);

  console.log('\n5. Activate with trailing slash double-slash resilience (//api/v1/...):');
  const doubleSlash = await post('//api/v1/dubber-bei-sach-voice-clone-pro/license/verify', {
    license_key: 'DUB-RLNM-JDST-WC9V-MKLM',
    hardware_id: 'HWID-CLIENT-001'
  });
  console.log('Double-slash response:', doubleSlash);
}

run().catch(console.error);
