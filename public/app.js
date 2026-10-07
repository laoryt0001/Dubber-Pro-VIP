// license-server/public/app.js
(function () {
  'use strict';

  let currentToken = localStorage.getItem('license_admin_token') || null;
  let currentUsername = localStorage.getItem('license_admin_user') || 'admin';
  let cachedLicenses = [];

  // DOM Elements
  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const displayUsername = document.getElementById('display-username');
  const btnLogout = document.getElementById('btn-logout');

  // Stats Elements
  const statTotal = document.getElementById('stat-total');
  const statActive = document.getElementById('stat-active');
  const statDevices = document.getElementById('stat-devices');
  const statExpired = document.getElementById('stat-expired');

  // Table & Controls
  const licensesTbody = document.getElementById('licenses-tbody');
  const searchInput = document.getElementById('search-input');
  const filterApp = document.getElementById('filter-app');
  const filterStatus = document.getElementById('filter-status');
  const filterPlan = document.getElementById('filter-plan');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnOpenCreate = document.getElementById('btn-open-create-modal');
  const btnDocs = document.getElementById('btn-docs');

  // Modals
  const modalCreate = document.getElementById('modal-create');
  const formCreate = document.getElementById('create-license-form');
  const createApp = document.getElementById('create-app');
  const selectPlan = document.getElementById('create-plan');
  const customDaysGroup = document.getElementById('custom-days-group');

  const modalDevices = document.getElementById('modal-devices');
  const devicesTbody = document.getElementById('devices-tbody');
  const devicesSubtitle = document.getElementById('devices-modal-subtitle');

  const modalExtend = document.getElementById('modal-extend');
  const formExtend = document.getElementById('extend-form');
  const extendIdInput = document.getElementById('extend-license-id');
  const extendKeyLabel = document.getElementById('extend-license-key');

  const modalDocs = document.getElementById('modal-docs');

  // Toast System
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : '⚠️';
    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
  }

  // API Client
  async function api(endpoint, options = {}) {
    options.headers = options.headers || {};
    options.headers['Content-Type'] = 'application/json';
    if (currentToken) {
      options.headers['Authorization'] = `Bearer ${currentToken}`;
    }

    try {
      const res = await fetch(endpoint, options);
      const data = await res.json().catch(() => ({}));

      if (res.status === 401 && currentToken) {
        // Session expired
        logout();
        throw new Error('Session expired. Please log in again.');
      }

      if (!res.ok) {
        throw new Error(data.error || `HTTP error ${res.status}`);
      }

      return data;
    } catch (err) {
      throw err;
    }
  }

  // Auth Handling
  function setAuthenticated(token, username) {
    currentToken = token;
    currentUsername = username || 'admin';
    if (token) {
      localStorage.setItem('license_admin_token', token);
      localStorage.setItem('license_admin_user', currentUsername);
      displayUsername.textContent = currentUsername;
      loginView.classList.add('hidden');
      dashboardView.classList.remove('hidden');
      loadDashboard();
    } else {
      localStorage.removeItem('license_admin_token');
      localStorage.removeItem('license_admin_user');
      loginView.classList.remove('hidden');
      dashboardView.classList.add('hidden');
    }
  }

  function logout() {
    setAuthenticated(null);
    showToast('Logged out of admin session');
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const res = await api('/api/v1/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      showToast(`Welcome back, ${res.username}!`);
      setAuthenticated(res.token, res.username);
    } catch (err) {
      loginError.textContent = err.message || 'Login failed';
      loginError.classList.remove('hidden');
    }
  });

  btnLogout.addEventListener('click', logout);

  // Load Data
  async function loadDashboard() {
    await Promise.all([loadStats(), loadLicenses()]);
  }

  async function loadStats() {
    try {
      const stats = await api('/api/v1/admin/stats');
      statTotal.textContent = stats.totalLicenses;
      statActive.textContent = stats.activeLicenses;
      statDevices.textContent = stats.totalDeviceActivations;
      statExpired.textContent = Number(stats.expiredLicenses || 0) + Number(stats.revokedLicenses || 0);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }

  async function loadLicenses() {
    licensesTbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          <div class="loading-spinner"></div>
          <p>Loading license inventory...</p>
        </td>
      </tr>
    `;

    try {
      const search = searchInput.value.trim();
      const app = filterApp ? filterApp.value : '';
      const status = filterStatus.value;
      const plan = filterPlan.value;

      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (app) params.append('app', app);
      if (status) params.append('status', status);
      if (plan) params.append('plan', plan);

      const res = await api(`/api/v1/admin/licenses?${params.toString()}`);
      cachedLicenses = res.licenses || [];
      renderLicenses(cachedLicenses);
    } catch (err) {
      licensesTbody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-state" style="color: var(--accent-rose);">
            ⚠️ Error loading licenses: ${escapeHtml(err.message)}
          </td>
        </tr>
      `;
    }
  }

  function renderLicenses(licenses) {
    if (licenses.length === 0) {
      licensesTbody.innerHTML = `
        <tr>
          <td colspan="9" class="empty-state">
            <p>No licenses found matching your filters.</p>
            <button class="btn btn-primary btn-sm" style="margin-top: 12px;" onclick="document.getElementById('btn-open-create-modal').click()">
              + Generate First License
            </button>
          </td>
        </tr>
      `;
      return;
    }

    licensesTbody.innerHTML = licenses.map(lic => {
      const isExpired = lic.expires_at && new Date(lic.expires_at).getTime() < Date.now();
      let statusBadge = `<span class="badge badge-active">Active</span>`;
      if (lic.status === 'revoked') {
        statusBadge = `<span class="badge badge-revoked">Revoked</span>`;
      } else if (isExpired) {
        statusBadge = `<span class="badge badge-expired">Expired</span>`;
      }

      const appBadge = lic.app === 'sdach-moan'
        ? `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">👑 Sdach Moan</span>`
        : `<span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3);">🎙️ Dubber Pro</span>`;

      let expiryText = 'Lifetime';
      if (lic.expires_at) {
        const d = new Date(lic.expires_at);
        expiryText = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      const activeDevs = lic.active_devices_count || (lic.activations ? lic.activations.length : 0);
      const devicesLabel = `${activeDevs} / ${lic.max_devices}`;

      const createdDate = new Date(lic.created_at).toLocaleDateString();

      return `
        <tr data-id="${lic.id}">
          <td>
            <div class="key-badge">
              <span>${escapeHtml(lic.key)}</span>
              <button class="btn-copy-key" title="Copy Key" data-copy="${escapeHtml(lic.key)}">📋</button>
            </div>
          </td>
          <td>${appBadge}</td>
          <td>
            <div style="font-weight: 600;">${escapeHtml(lic.customer_name || 'Anonymous')}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(lic.customer_email || 'No email')}</div>
          </td>
          <td>
            <span class="badge badge-plan">${escapeHtml(lic.plan)}</span>
          </td>
          <td>
            <a class="device-badge-link" data-action="view-devices" data-id="${lic.id}">
              💻 ${devicesLabel}
            </a>
          </td>
          <td>
            <span style="font-size: 0.85rem; color: ${isExpired ? 'var(--accent-gold)' : 'var(--text-primary)'};">
              ${expiryText}
            </span>
          </td>
          <td>${statusBadge}</td>
          <td style="font-size: 0.82rem; color: var(--text-muted);">${createdDate}</td>
          <td class="text-right">
            <div style="display: inline-flex; gap: 6px;">
              <button class="btn btn-secondary btn-sm" data-action="extend" data-id="${lic.id}" data-key="${escapeHtml(lic.key)}" title="Extend Expiration">
                ⏳ Extend
              </button>
              ${lic.status === 'active' ? `
                <button class="btn btn-danger btn-sm" data-action="revoke" data-id="${lic.id}" data-key="${escapeHtml(lic.key)}" title="Revoke License">
                  🚫 Revoke
                </button>
              ` : `
                <button class="btn btn-secondary btn-sm" data-action="delete" data-id="${lic.id}" title="Delete License">
                  🗑️
                </button>
              `}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Attach copy button listeners
    document.querySelectorAll('.btn-copy-key').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = btn.getAttribute('data-copy');
        navigator.clipboard.writeText(key).then(() => {
          showToast(`Copied ${key} to clipboard!`);
        });
      });
    });

    // Attach row action listeners
    document.querySelectorAll('[data-action="view-devices"]').forEach(el => {
      el.addEventListener('click', () => openDevicesModal(Number(el.getAttribute('data-id'))));
    });

    document.querySelectorAll('[data-action="extend"]').forEach(el => {
      el.addEventListener('click', () => {
        openExtendModal(Number(el.getAttribute('data-id')), el.getAttribute('data-key'));
      });
    });

    document.querySelectorAll('[data-action="revoke"]').forEach(el => {
      el.addEventListener('click', () => {
        revokeLicense(Number(el.getAttribute('data-id')), el.getAttribute('data-key'));
      });
    });

    document.querySelectorAll('[data-action="delete"]').forEach(el => {
      el.addEventListener('click', () => {
        deleteLicense(Number(el.getAttribute('data-id')));
      });
    });
  }

  // Create License Modal Logic
  selectPlan.addEventListener('change', () => {
    if (selectPlan.value === 'Custom') {
      customDaysGroup.style.display = 'flex';
    } else {
      customDaysGroup.style.display = 'none';
    }
  });

  if (createApp) {
    createApp.addEventListener('change', () => {
      const isDubber = createApp.value === 'dubber-pro';
      document.getElementById('create-prefix').value = isDubber ? 'DUB' : 'VIP';
      if (isDubber) {
        selectPlan.innerHTML = `
          <option value="Dubber Pro Lifetime" selected>Dubber Pro Lifetime (Never Expires)</option>
          <option value="Dubber Pro 1-Year">Dubber Pro 1-Year (365 Days)</option>
          <option value="Dubber Pro 30-Day">Dubber Pro 30-Day (1 Month)</option>
          <option value="Custom">Custom Duration</option>
        `;
      } else {
        selectPlan.innerHTML = `
          <option value="VIP Lifetime" selected>VIP Lifetime (Never Expires)</option>
          <option value="VIP 1-Year">VIP 1-Year (365 Days)</option>
          <option value="VIP 30-Day">VIP 30-Day (1 Month)</option>
          <option value="VIP 7-Day">VIP 7-Day Trial</option>
          <option value="Custom">Custom Duration</option>
        `;
      }
    });
  }

  btnOpenCreate.addEventListener('click', () => {
    formCreate.reset();
    if (createApp) createApp.value = 'dubber-pro';
    document.getElementById('create-prefix').value = 'DUB';
    selectPlan.innerHTML = `
      <option value="Dubber Pro Lifetime" selected>Dubber Pro Lifetime (Never Expires)</option>
      <option value="Dubber Pro 1-Year">Dubber Pro 1-Year (365 Days)</option>
      <option value="Dubber Pro 30-Day">Dubber Pro 30-Day (1 Month)</option>
      <option value="Custom">Custom Duration</option>
    `;
    selectPlan.value = 'Dubber Pro Lifetime';
    customDaysGroup.style.display = 'none';
    modalCreate.classList.remove('hidden');
  });

  formCreate.addEventListener('submit', async (e) => {
    e.preventDefault();

    const app = createApp ? createApp.value : 'dubber-pro';
    const plan = selectPlan.value;
    let daysValid = 0;
    if (plan.includes('30-Day')) daysValid = 30;
    else if (plan.includes('1-Year')) daysValid = 365;
    else if (plan.includes('7-Day')) daysValid = 7;
    else if (plan === 'Custom') daysValid = Number(document.getElementById('create-days').value) || 30;
    else if (plan.includes('Lifetime')) daysValid = 0;

    const features = [];
    document.querySelectorAll('input[name="feat"]:checked').forEach(cb => features.push(cb.value));

    const payload = {
      app,
      prefix: document.getElementById('create-prefix').value.trim() || (app === 'sdach-moan' ? 'VIP' : 'DUB'),
      customKey: document.getElementById('create-custom-key').value.trim() || undefined,
      customerName: document.getElementById('create-name').value.trim(),
      customerEmail: document.getElementById('create-email').value.trim(),
      plan,
      maxDevices: Number(document.getElementById('create-devices').value),
      daysValid: daysValid > 0 ? daysValid : undefined,
      features,
      notes: document.getElementById('create-notes').value.trim()
    };

    try {
      const res = await api('/api/v1/admin/licenses', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      modalCreate.classList.add('hidden');
      showToast(`Key Created: ${res.license.key}`);
      loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Devices Modal
  async function openDevicesModal(licenseId) {
    modalDevices.classList.remove('hidden');
    devicesTbody.innerHTML = `
      <tr><td colspan="6" class="empty-state"><div class="loading-spinner"></div>Loading devices...</td></tr>
    `;

    try {
      const lic = await api(`/api/v1/admin/licenses/${licenseId}`);
      devicesSubtitle.textContent = `License: ${lic.key} (${lic.customer_name || 'Anonymous'})`;

      if (!lic.activations || lic.activations.length === 0) {
        devicesTbody.innerHTML = `
          <tr><td colspan="6" class="empty-state">No machines currently activated with this key.</td></tr>
        `;
        return;
      }

      devicesTbody.innerHTML = lic.activations.map(a => `
        <tr>
          <td><span class="font-mono text-sm">${escapeHtml(a.device_id)}</span></td>
          <td><strong>${escapeHtml(a.device_name || 'Machine')}</strong></td>
          <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(a.os_info || 'Unknown OS')}</td>
          <td><span class="font-mono text-sm">${escapeHtml(a.ip_address || '-')}</span></td>
          <td style="font-size: 0.82rem;">${new Date(a.last_seen_at).toLocaleString()}</td>
          <td class="text-right">
            <button class="btn btn-danger btn-sm" data-deact-key="${escapeHtml(lic.key)}" data-deact-device="${escapeHtml(a.device_id)}">
              Deactivate
            </button>
          </td>
        </tr>
      `).join('');

      devicesTbody.querySelectorAll('[data-deact-device]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const key = btn.getAttribute('data-deact-key');
          const devId = btn.getAttribute('data-deact-device');
          if (confirm(`Deactivate machine "${devId}" from this license?`)) {
            try {
              await api('/api/v1/license/deactivate', {
                method: 'POST',
                body: JSON.stringify({ key, deviceId: devId })
              });
              showToast('Device deactivated successfully');
              openDevicesModal(licenseId);
              loadDashboard();
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
        });
      });
    } catch (err) {
      devicesTbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color: var(--accent-rose);">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // Extend Modal
  function openExtendModal(id, key) {
    extendIdInput.value = id;
    extendKeyLabel.textContent = `License Key: ${key}`;
    modalExtend.classList.remove('hidden');
  }

  formExtend.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = extendIdInput.value;
    const days = document.getElementById('extend-days').value;

    try {
      await api(`/api/v1/admin/licenses/${id}/extend`, {
        method: 'POST',
        body: JSON.stringify({ days })
      });
      modalExtend.classList.add('hidden');
      showToast(`License extended by ${days} days`);
      loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Revoke & Delete
  async function revokeLicense(id, key) {
    if (!confirm(`Are you sure you want to REVOKE license ${key}? The user's application will be disabled.`)) {
      return;
    }
    try {
      await api(`/api/v1/admin/licenses/${id}/revoke`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Revoked via Admin Dashboard' })
      });
      showToast(`License ${key} has been revoked.`);
      loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function deleteLicense(id) {
    if (!confirm('Are you sure you want to permanently delete this license record?')) {
      return;
    }
    try {
      await api(`/api/v1/admin/licenses/${id}`, { method: 'DELETE' });
      showToast('License permanently deleted');
      loadDashboard();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Search & Filter Listeners
  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadLicenses, 300);
  });

  if (filterApp) filterApp.addEventListener('change', loadLicenses);
  filterStatus.addEventListener('change', loadLicenses);
  filterPlan.addEventListener('change', loadLicenses);
  btnRefresh.addEventListener('click', loadDashboard);

  // Docs modal
  btnDocs.addEventListener('click', () => modalDocs.classList.remove('hidden'));

  // Close Modals
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      document.getElementById(modalId).classList.add('hidden');
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
    }
  });

  // Init
  if (currentToken) {
    setAuthenticated(currentToken, currentUsername);
  } else {
    setAuthenticated(null);
  }
})();
