# 👑 Dubber Pro VIP - License Management Server

A secure, high-performance, self-contained License Management System and REST API built with Node.js and SQLite.

🌐 **Live Web Dashboard (GitHub Pages)**: [https://laoryt0001.github.io/Dubber-Pro-VIP/](https://laoryt0001.github.io/Dubber-Pro-VIP/)

---

## 🌟 Key Features

- **Zero External Dependencies**: Operates entirely on native Node.js built-ins (`node:sqlite`, `node:crypto`, `node:http`). No `npm install` compilation errors.
- **Ed25519 Asymmetric Cryptography**: Every license token is digitally signed. Client applications can verify licenses offline with the server's public key during network outages.
- **Hardware Binding (HWID)**: Enforces device limits per license key (e.g. 1 machine, 3 machines, or unlimited).
- **Modern Web Admin Dashboard**: Sleek dark-mode glassmorphic UI to generate keys, inspect bound devices, revoke licenses, and view live statistics.
- **Command-Line Interface (CLI)**: Issue and manage licenses directly from your terminal.
- **Client SDK (`licenseClient.js`)**: Plug-and-play module for Electron or Node.js client applications.
- **Docker & Cloud Ready**: Pre-configured for Docker, Render, Railway, and VPS hosting.

---

## 🌐 Cloud Hosting & Online Deployment

### Option A: Free 1-Click Hosting on Render.com (Recommended)
1. Push this repository to GitHub: `https://github.com/laoryt0001/Dubber-Pro-VIP.git`
2. Go to [render.com](https://render.com) and sign in with GitHub.
3. Click **New +** -> **Web Service** -> select your repository `Dubber-Pro-VIP`.
4. Render will auto-detect `render.yaml` or you can choose:
   - **Environment**: Node
   - **Build Command**: `npm install --omit=dev`
   - **Start Command**: `node server.js`
5. Click **Deploy Web Service**. You will get an online HTTPS URL (e.g. `https://dubber-pro-vip.onrender.com`).
6. Point your client apps to this URL in `licenseClient.js`:
   ```javascript
   const client = new LicenseClient({
     serverUrl: 'https://dubber-pro-vip.onrender.com'
   });
   ```

### Option B: Deploy with Docker / VPS
```bash
# Build and run with Docker Compose
docker compose up -d

# Or run standalone Docker container
docker build -t dubber-pro-vip-server .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --name dubber-server dubber-pro-vip-server
```

---

## 🚀 Local Quick Start

### 1. Start the License Server locally

```bash
node server.js
```

The server will start listening at:
- **Web Dashboard**: `http://localhost:3000`
- **Default Username**: `admin`
- **Default Password**: `admin123`

---

## 💻 CLI Commands

You can generate and manage licenses directly from the command line:

```bash
# Generate a 30-day VIP license for a customer
node cli.js create --name "Sokha Chan" --email "sokha@example.com" --plan "VIP 30-Day" --days 30 --devices 1

# Generate a Lifetime VIP license
node cli.js lifetime --name "VIP Member" --devices 2

# List all licenses
node cli.js list

# Inspect a specific license and its activated devices
node cli.js info VIP-XXXX-XXXX-XXXX-XXXX

# Extend an existing license by 30 days (by license ID)
node cli.js extend 1 30

# Revoke a license
node cli.js revoke VIP-XXXX-XXXX-XXXX-XXXX

# View server statistics
node cli.js stats
```

---

## 🔌 Electron / Client App Integration

Include `licenseClient.js` in your application to handle activation and verification:

```javascript
const { LicenseClient } = require('./licenseClient');

const client = new LicenseClient({
  serverUrl: 'http://localhost:3000' // Or your remote deployed URL
});

// 1. Activate when user inputs their VIP key:
async function onUserSubmitKey(enteredKey) {
  const result = await client.activate(enteredKey);
  if (result.valid) {
    console.log('✅ License Activated!');
    console.log('Plan:', result.plan);
    console.log('Expires:', result.expiresAt || 'Lifetime');
    console.log('Features:', result.features);
  } else {
    console.error('❌ Activation Failed:', result.error);
  }
}

// 2. Check license status on application launch:
async function checkLicenseOnStartup() {
  const status = await client.verify();
  if (status.valid) {
    console.log('App unlocked. Mode:', status.online ? 'Online' : 'Offline Verified');
    return true;
  } else {
    console.log('App locked. Prompt user for VIP license.');
    return false;
  }
}

// 3. Check for specific feature permissions:
if (client.hasFeature('downloads')) {
  // Allow high-speed VIP download
}
```

---

## 📡 REST API Reference

### Public Client Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Service health status |
| `GET` | `/api/v1/license/public-key` | Fetch server Ed25519 public key |
| `POST` | `/api/v1/license/activate` | Activate a key with machine HWID |
| `POST` | `/api/v1/license/verify` | Verify license validity (heartbeat) |
| `POST` | `/api/v1/license/deactivate` | Deactivate machine from a key |

#### Example: Activate License (`POST /api/v1/license/activate`)
```json
{
  "key": "VIP-XXXX-XXXX-XXXX-XXXX",
  "deviceId": "machine-fingerprint-sha256",
  "deviceName": "DESKTOP-ABC (Admin)",
  "osInfo": "Windows_NT 10.0.19045 x64"
}
```

### Admin Endpoints (Require Bearer Token)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/admin/login` | Authenticate admin (`admin` / `admin123`) |
| `GET` | `/api/v1/admin/stats` | Summary statistics |
| `GET` | `/api/v1/admin/licenses` | List licenses (supports search, filter, pagination) |
| `POST` | `/api/v1/admin/licenses` | Generate new license |
| `GET` | `/api/v1/admin/licenses/:id` | Fetch license detail with bound machines |
| `POST` | `/api/v1/admin/licenses/:id/extend` | Add N days to expiration |
| `POST` | `/api/v1/admin/licenses/:id/revoke` | Revoke license |
| `DELETE` | `/api/v1/admin/licenses/:id` | Delete license record |
| `GET` | `/api/v1/admin/logs` | Fetch audit event log |

---

## 📁 Directory Structure

```
license-server/
├── server.js             # HTTP REST API server & static file host
├── db.js                 # SQLite database schema and helper queries
├── cryptoUtils.js        # Ed25519 asymmetric cryptography & keygen
├── licenseClient.js      # Client SDK for Electron / Node.js apps
├── cli.js                # Command-line interface tool
├── package.json          # Package manifest and npm scripts
├── README.md             # Documentation
├── test_server.js        # Automated verification test suite
├── public/               # Admin Web Dashboard
│   ├── index.html        # Modern dashboard layout & modal dialogs
│   ├── style.css         # Glassmorphic dark styling & responsive design
│   └── app.js            # Dashboard state, API calls, and events
└── data/                 # Auto-generated database & cryptographic keys
    ├── licenses.db       # SQLite database file
    └── keys.json         # Server Ed25519 keypair
```
