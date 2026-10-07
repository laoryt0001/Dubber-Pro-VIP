#!/usr/bin/env node
// license-server/cli.js
const db = require('./db');
const { generateLicenseKey } = require('./cryptoUtils');

const args = process.argv.slice(2);
const command = args[0] || 'help';

function printHelp() {
  console.log(`
👑 Sdach Moan VIP - License Server CLI

Usage:
  node cli.js <command> [options]

Commands:
  create           Generate a new license key
                   Options:
                     --plan <name>        Plan name (default: "VIP 30-Day")
                     --days <number>      Validity days (default: 30, 0 for lifetime)
                     --devices <number>   Max activations (default: 1)
                     --name <customer>    Customer name
                     --email <email>      Customer email
                     --prefix <prefix>    Key prefix (default: VIP)
                     --key <custom_key>   Specify custom key instead of generating

  lifetime         Shortcut to create a lifetime VIP key
                   Options: --name <customer>, --devices <number>

  list             List all registered licenses
                   Options: --status <active|revoked>

  info <key>       Show detailed information and bound devices for a key

  revoke <key>     Revoke a license key immediately

  extend <id> <days> Extend an existing license by N days

  stats            Display license server statistics

  help             Show this help menu
`);
}

function parseFlags(argList) {
  const flags = {};
  for (let i = 0; i < argList.length; i++) {
    if (argList[i].startsWith('--')) {
      const key = argList[i].slice(2);
      const val = argList[i + 1] && !argList[i + 1].startsWith('--') ? argList[++i] : true;
      flags[key] = val;
    }
  }
  return flags;
}

switch (command) {
  case 'create': {
    const flags = parseFlags(args.slice(1));
    const app = flags.app || 'dubber-pro';
    const defaultPrefix = app === 'sdach-moan' ? 'VIP' : 'DUB';
    const prefix = flags.prefix || defaultPrefix;
    const key = flags.key || generateLicenseKey(prefix);
    const defaultPlan = app === 'sdach-moan' ? 'VIP 30-Day' : 'Dubber Pro 30-Day';
    const plan = flags.plan || defaultPlan;
    const days = flags.days !== undefined ? Number(flags.days) : 30;
    const maxDevices = flags.devices ? Number(flags.devices) : 1;
    const customerName = flags.name || 'Anonymous';
    const customerEmail = flags.email || null;

    let expiresAt = null;
    if (days > 0) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      expiresAt = d.toISOString();
    }

    const defaultFeatures = app === 'sdach-moan'
      ? ['downloads', 'batch_mode', 'vip_access']
      : ['khmer_voice_clone', 'ai_dubbing', 'whisper_stt', 'unlimited_export'];

    const lic = db.createLicense({
      key,
      app,
      customerName,
      customerEmail,
      plan,
      maxDevices,
      expiresAt,
      features: defaultFeatures,
      notes: 'Generated via CLI'
    });

    console.log(`\n✅ License Key Created Successfully!`);
    console.log(`-----------------------------------------------`);
    console.log(`🔑 Key:          ${lic.key}`);
    console.log(`📱 App:          ${lic.app || 'dubber-pro'}`);
    console.log(`👤 Customer:     ${lic.customer_name || 'Anonymous'}`);
    console.log(`📦 Plan:         ${lic.plan}`);
    console.log(`💻 Max Devices:  ${lic.max_devices}`);
    console.log(`⏳ Expires:      ${lic.expires_at ? new Date(lic.expires_at).toLocaleString() : 'Lifetime (Never)'}`);
    console.log(`-----------------------------------------------\n`);
    break;
  }

  case 'dubber': {
    const flags = parseFlags(args.slice(1));
    const key = generateLicenseKey('DUB');
    const customerName = flags.name || 'Dubber Pro Member';
    const maxDevices = flags.devices ? Number(flags.devices) : 1;

    const lic = db.createLicense({
      key,
      app: 'dubber-pro',
      customerName,
      plan: 'Dubber Pro Lifetime',
      maxDevices,
      expiresAt: null,
      features: ['khmer_voice_clone', 'ai_dubbing', 'whisper_stt', 'unlimited_export'],
      notes: 'Created via CLI (Dubber Lifetime)'
    });

    console.log(`\n🎙️ Dubber បីសាច [ Clone សម្លេង Pro ] - LIFETIME Key Created!`);
    console.log(`-----------------------------------------------`);
    console.log(`🔑 Key:          ${lic.key}`);
    console.log(`👤 Customer:     ${lic.customer_name}`);
    console.log(`💻 Max Devices:  ${lic.max_devices}`);
    console.log(`⏳ Expires:      Never (Lifetime)`);
    console.log(`-----------------------------------------------\n`);
    break;
  }

  case 'lifetime': {
    const flags = parseFlags(args.slice(1));
    const key = generateLicenseKey('VIP');
    const customerName = flags.name || 'VIP Member';
    const maxDevices = flags.devices ? Number(flags.devices) : 2;

    const lic = db.createLicense({
      key,
      app: 'sdach-moan',
      customerName,
      plan: 'VIP Lifetime',
      maxDevices,
      expiresAt: null,
      features: ['downloads', 'batch_mode', 'vip_access', 'hd_export'],
      notes: 'Created via CLI (Lifetime)'
    });

    console.log(`\n👑 VIP LIFETIME Key Created!`);
    console.log(`-----------------------------------------------`);
    console.log(`🔑 Key:          ${lic.key}`);
    console.log(`👤 Customer:     ${lic.customer_name}`);
    console.log(`💻 Max Devices:  ${lic.max_devices}`);
    console.log(`⏳ Expires:      Never (Lifetime)`);
    console.log(`-----------------------------------------------\n`);
    break;
  }

  case 'list': {
    const flags = parseFlags(args.slice(1));
    const licenses = db.getAllLicenses({ status: flags.status || '', app: flags.app || '', limit: 100 });
    console.log(`\n📋 Registered Licenses (${licenses.length}):`);
    console.log(`------------------------------------------------------------------------------------------------------`);
    console.log(`ID  | Key                      | App         | Plan          | Status   | Devices | Expires`);
    console.log(`------------------------------------------------------------------------------------------------------`);
    licenses.forEach(l => {
      const idStr = String(l.id).padEnd(3);
      const keyStr = l.key.padEnd(24);
      const appStr = (l.app || 'dubber-pro').slice(0, 11).padEnd(11);
      const planStr = (l.plan || 'VIP').slice(0, 13).padEnd(13);
      const statusStr = (l.status || 'active').padEnd(8);
      const devStr = `${l.active_devices_count || 0}/${l.max_devices}`.padEnd(7);
      const expStr = l.expires_at ? new Date(l.expires_at).toLocaleDateString() : 'Lifetime';
      console.log(`${idStr} | ${keyStr} | ${appStr} | ${planStr} | ${statusStr} | ${devStr} | ${expStr}`);
    });
    console.log(`------------------------------------------------------------------------------------------------------\n`);
    break;
  }

  case 'info': {
    const key = args[1];
    if (!key) {
      console.error('Error: Please provide a license key. Example: node cli.js info VIP-XXXX-XXXX-XXXX-XXXX');
      process.exit(1);
    }
    const lic = db.getLicenseByKey(key.trim().toUpperCase());
    if (!lic) {
      console.error(`Error: License key "${key}" not found.`);
      process.exit(1);
    }

    console.log(`\n🔍 License Details for ${lic.key}:`);
    console.log(`-----------------------------------------------`);
    console.log(`ID:           ${lic.id}`);
    console.log(`Customer:     ${lic.customer_name || 'Anonymous'} <${lic.customer_email || 'No email'}>`);
    console.log(`Plan:         ${lic.plan}`);
    console.log(`Status:       ${lic.status}`);
    console.log(`Expires:      ${lic.expires_at ? new Date(lic.expires_at).toLocaleString() : 'Lifetime'}`);
    console.log(`Max Devices:  ${lic.max_devices}`);
    console.log(`Features:     ${lic.features.join(', ')}`);
    console.log(`\n💻 Bound Devices (${lic.activations.length}):`);
    lic.activations.forEach((a, i) => {
      console.log(`  [${i + 1}] ID: ${a.device_id}`);
      console.log(`      Name: ${a.device_name} | IP: ${a.ip_address}`);
      console.log(`      Last Seen: ${new Date(a.last_seen_at).toLocaleString()}`);
    });
    console.log(`-----------------------------------------------\n`);
    break;
  }

  case 'revoke': {
    const key = args[1];
    if (!key) {
      console.error('Error: Please specify the license key to revoke.');
      process.exit(1);
    }
    const lic = db.revokeLicense(key.trim().toUpperCase(), 'Revoked via CLI');
    if (!lic) {
      console.error(`Error: License "${key}" not found.`);
      process.exit(1);
    }
    console.log(`🚫 License ${lic.key} has been revoked.`);
    break;
  }

  case 'extend': {
    const id = args[1];
    const days = args[2] || 30;
    if (!id) {
      console.error('Error: Please specify license ID and days. Example: node cli.js extend 1 30');
      process.exit(1);
    }
    const lic = db.extendLicense(id, days);
    if (!lic) {
      console.error(`Error: License ID "${id}" not found.`);
      process.exit(1);
    }
    console.log(`⏳ License ${lic.key} extended by ${days} days. New Expiry: ${new Date(lic.expires_at).toLocaleString()}`);
    break;
  }

  case 'stats': {
    const s = db.getStats();
    console.log(`\n📊 License Server Statistics:`);
    console.log(`-----------------------------------------------`);
    console.log(`Total Licenses:          ${s.totalLicenses}`);
    console.log(`Active Licenses:         ${s.activeLicenses}`);
    console.log(`Expired Licenses:        ${s.expiredLicenses}`);
    console.log(`Revoked Licenses:        ${s.revokedLicenses}`);
    console.log(`Total Device Activations:${s.totalDeviceActivations}`);
    console.log(`-----------------------------------------------\n`);
    break;
  }

  case 'help':
  default:
    printHelp();
    break;
}
