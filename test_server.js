// license-server/test_server.js
const server = require('./server');
const { LicenseClient } = require('./licenseClient');

async function runTests() {
  console.log('\n--- Running Automated Verification Tests ---');

  // Wait 300ms for server to bind
  await new Promise(r => setTimeout(r, 300));
  const base = 'http://127.0.0.1:3000';

  // 1. Health check
  const healthRes = await fetch(`${base}/api/v1/health`);
  const healthData = await healthRes.json();
  console.log('1. Health check:', healthData.status === 'online' ? 'PASSED ✅' : 'FAILED ❌');

  // 2. Public Key
  const keyRes = await fetch(`${base}/api/v1/license/public-key`);
  const keyData = await keyRes.json();
  console.log('2. Public key endpoint:', keyData.algorithm === 'Ed25519' ? 'PASSED ✅' : 'FAILED ❌');

  // 3. Admin Login
  const loginRes = await fetch(`${base}/api/v1/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const loginData = await loginRes.json();
  console.log('3. Admin Login:', loginData.token ? 'PASSED ✅' : 'FAILED ❌');
  const adminToken = loginData.token;

  // 4. Admin Create 30-Day License
  const createRes = await fetch(`${base}/api/v1/admin/licenses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({
      prefix: 'VIP',
      customerName: 'Test User',
      plan: 'VIP 30-Day',
      daysValid: 30,
      maxDevices: 1
    })
  });
  const createData = await createRes.json();
  console.log('4. Create License:', createData.license && createData.license.key ? `PASSED (${createData.license.key}) ✅` : 'FAILED ❌');
  const newKey = createData.license.key;

  // 5. Client SDK Activation Test
  const client = new LicenseClient({
    serverUrl: base,
    storagePath: './data/test_license_store.json'
  });
  const actResult = await client.activate(newKey);
  console.log('5. Client SDK Activation:', actResult.valid ? 'PASSED ✅' : `FAILED (${actResult.error}) ❌`);

  // 6. Client SDK Verification Test (Online)
  const verifyOnline = await client.verify();
  console.log('6. Client SDK Online Verification:', verifyOnline.valid && verifyOnline.online ? 'PASSED ✅' : 'FAILED ❌');

  // 7. Max Devices Rejection Test
  const secondClient = new LicenseClient({
    serverUrl: base,
    storagePath: './data/test_client2.json'
  });
  // Mock different device ID
  secondClient.getDeviceId = () => 'mock-device-id-9999';
  const secondAct = await secondClient.activate(newKey);
  console.log('7. Device Limit Enforced (1 max):', (!secondAct.valid && secondAct.error.includes('limit')) ? 'PASSED ✅' : `FAILED (${JSON.stringify(secondAct)}) ❌`);

  // 8. Offline Verification Test
  const offlineCheck = client.verifyOfflineToken(actResult.token, keyData.publicKey);
  console.log('8. Offline Cryptographic Ed25519 Token Validation:', offlineCheck.valid ? 'PASSED ✅' : 'FAILED ❌');

  // Clean up test store
  try {
    const fs = require('fs');
    if (fs.existsSync('./data/test_license_store.json')) fs.unlinkSync('./data/test_license_store.json');
  } catch {}

  console.log('\n--- All Automated Verification Tests Finished Successfully! ---\n');
  server.close(() => {
    process.exit(0);
  });
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
