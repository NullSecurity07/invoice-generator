// ── Utility: HTML Escaping ──────────────────────────────────
function escapeHTML(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ── API Base & Token Helpers ──────────────────────────────────
// Automatically use localhost for local dev and the secure backend URL for production
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

// Backend and frontend are served from the same server — always use current origin
const BACKEND_URL = typeof window.ENV_API_URL !== 'undefined' ? window.ENV_API_URL : window.location.origin;
const API = isLocal ? `http://localhost:3000/api` : `${BACKEND_URL}/api`;

// No longer storing token in localStorage, it's in HttpOnly cookie.
// function getToken() { return localStorage.getItem('blc_token'); }

function getUser()  { try { return JSON.parse(localStorage.getItem('blc_user')); } catch{ return null; } }

// No longer saving token to localStorage.
function saveSession(user) {
  localStorage.setItem('blc_user', JSON.stringify(user));
}

// Clear user data from localStorage and call backend to clear HttpOnly cookie
async function clearSession() {
  localStorage.removeItem('blc_user');
  await fetch(API + '/auth/logout', { method: 'POST' }); // Call backend logout to clear HttpOnly cookie
}

async function requireAuth(redirectRole) {
  let user = getUser();
  // If user data is not in localStorage or if it's outdated, fetch from backend.
  // The backend will verify the HttpOnly cookie.
  if (!user) {
    try {
      const data = await apiFetch('/auth/me');
      if (data) {
        user = { id: data.id, name: data.name, email: data.email, role: data.role };
        saveSession(user);
        
        // Populate sidebar now that we have the user
        populateSidebarUser();

        // Initialize admin-specific features if applicable
        if (['admin', 'superadmin'].includes(user.role)) {
          initAdminReports();
        }
      }
    } catch (error) {
      console.warn('Authentication check failed:', error);
      clearSession(); // Clears localStorage and calls backend logout
      window.location.href = '/index.html';
      return null;
    }
  }

  // Double check if session was restored but sidebar not yet populated (e.g. DOM already loaded)
  if (user) {
    populateSidebarUser();
  }

  if (!user) { // If still no user, something went wrong or not authenticated
    clearSession();
    window.location.href = '/index.html';
    return null;
  }
  
  // Role-based redirection logic
  if (redirectRole && user.role !== redirectRole) {
    if (redirectRole === 'admin' && !['admin','superadmin'].includes(user.role)) {
      window.location.href = '/trainer/dashboard.html';
      return null;
    }
    if (redirectRole === 'trainer' && ['admin','superadmin'].includes(user.role)) {
      window.location.href = '/admin/dashboard.html';
      return null;
    }
  }
  return user;
}

// ── Fetch Wrapper ─────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  // With HttpOnly cookies, browser automatically sends the 'token' cookie.
  // No need to manually add Authorization header from localStorage.

  try {
    // credentials: 'include' is required to send HttpOnly cookies cross-domain (from GoDaddy to Render)
    const res = await fetch(API + path, { ...options, headers, credentials: 'include' });
    if (res.status === 401) {
      clearSession();
      window.location.href = '/index.html';
      return null;
    }
    if (options.responseType === 'blob') {
      return res; // Return the raw response for blob handling
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error((data && data.error) || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    throw err;
  }
}

// ── Toast Notifications ───────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const iconSpan = document.createElement('span');
  iconSpan.textContent = icons[type] || 'ℹ️';

  const messageSpan = document.createElement('span');
  messageSpan.textContent = message;
  
  toast.appendChild(iconSpan);
  toast.appendChild(messageSpan);

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(30px)';
    toast.style.transition = '0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Status Badge ──────────────────────────────────────────────
function statusBadge(status) {
  const labels = {
    draft:       'Draft',
    submitted:   'Submitted',
    under_review:'Under Review',
    approved:    'Approved',
    processing:  'Processing',
    paid:        'Paid',
    rejected:    'Rejected'
  };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

// ── Format currency ───────────────────────────────────────────
function formatINR(val) {
  if (val === null || val === undefined) return '—';
  return '₹ ' + parseFloat(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Format date ───────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Populate sidebar user info ────────────────────────────────
function populateSidebarUser() {
  const user = getUser();
  if (!user) return;
  const nameEl  = document.getElementById('sidebar-user-name');
  const roleEl  = document.getElementById('sidebar-user-role');
  const avatarEl = document.getElementById('sidebar-avatar');
  if (nameEl)   nameEl.textContent  = user.name || user.email;
  if (roleEl)   roleEl.textContent  = user.role;
  if (avatarEl) avatarEl.textContent = (user.name || user.email)[0].toUpperCase();
}

// ── Logout ────────────────────────────────────────────────────
function logout() {
  clearSession();
  window.location.href = '/index.html';
}

// ── Confirmation Dialog ───────────────────────────────────────
function confirmAction(message) {
  return new Promise(resolve => {
    const ok = window.confirm(message);
    resolve(ok);
  });
}

// ── Admin Excel Reports ─────────────────────────────────────────
async function initAdminReports() {
  const user = getUser();
  if (!user || !['admin','superadmin'].includes(user.role)) return;

  const navSection = document.querySelector('.sidebar-nav .nav-section');
  if (!navSection) return;

  // Add sidebar link
  const reportLink = document.createElement('a');
  reportLink.href = '#';
  reportLink.className = 'nav-item';
  reportLink.id = 'nav-excel-report';
  reportLink.innerHTML = `<span class="nav-icon">📈</span><span>Excel Reports</span>`;
  navSection.appendChild(reportLink);

  // Add Modal HTML
  const modal = document.createElement('div');
  modal.id = 'reportModal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content" style="max-width:450px;">
      <div class="modal-header">
        <h3>Excel Report Export</h3>
        <button class="modal-close" id="closeReportModal">&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Date Range (Submission Date)</label>
          <div style="display:flex; gap:10px;">
            <input type="date" id="reportFrom" class="form-control" placeholder="From">
            <input type="date" id="reportTo" class="form-control" placeholder="To">
          </div>
        </div>
        <div class="form-group mt-3">
          <label>Select Trainer</label>
          <select id="reportTrainerSelect" class="form-control" style="appearance: auto;">
            <option value="">All Trainers</option>
          </select>
        </div>
        <div style="margin-top:25px; display:flex; gap:10px;">
          <button id="btnDownloadExcel" class="btn btn-primary" style="flex:1">🚀 Download Excel</button>
          <button id="btnCancelReport" class="btn btn-ghost" style="flex:1">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Add Modal Style
  const style = document.createElement('style');
  style.textContent = `
    .modal-overlay#reportModal { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.4); display:none; align-items:center; justify-content:center; z-index:2000; backdrop-filter:blur(3px); }
    .modal-overlay#reportModal.open { display:flex; }
    .modal-content { background:var(--bg-card); border-radius:var(--radius); box-shadow:var(--shadow); width:90%; padding:24px; position:relative; animation: modalSlide 0.3s ease; }
    .modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; }
    .modal-close { background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-dim); }
    @keyframes modalSlide { from { opacity:0; transform:translateY(-20px); } to { opacity:1; transform:translateY(0); } }
    .trainer-opt { display:flex; align-items:center; gap:8px; padding:6px 0; font-size:0.85rem; border-bottom:1px solid var(--border-light); }
    .trainer-opt:last-child { border:none; }
    .trainer-opt input { cursor:pointer; }
  `;
  document.head.appendChild(style);

  // Event Listeners
  reportLink.onclick = (e) => { e.preventDefault(); openReportModal(); };
  document.getElementById('closeReportModal').onclick = closeReportModal;
  document.getElementById('btnCancelReport').onclick = closeReportModal;
  document.getElementById('btnDownloadExcel').onclick = handleExcelDownload;

  async function openReportModal() {
    modal.classList.add('open');
    loadTrainersForReport();
  }

  function closeReportModal() {
    modal.classList.remove('open');
  }

  async function loadTrainersForReport() {
    const select = document.getElementById('reportTrainerSelect');
    select.innerHTML = ''; // Clear existing options

    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'All Trainers';
    select.appendChild(defaultOption);

    try {
      const trainers = await apiFetch('/admin/users?role=trainer&is_active=1');
      if (trainers && trainers.length > 0) {
        trainers.forEach(t => {
          const option = document.createElement('option');
          option.value = t.id;
          option.textContent = `${t.name} (${t.email})`;
          select.appendChild(option);
        });
      }
    } catch (e) { console.error('Error loading trainers', e); }
  }

  async function handleExcelDownload() {
    const from = document.getElementById('reportFrom').value;
    const to = document.getElementById('reportTo').value;
    const trainerId = document.getElementById('reportTrainerSelect').value;
    const downloadBtn = document.getElementById('btnDownloadExcel');
    
    let url = `${API}/admin/reports/excel`;
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (trainerId) params.append('trainer_ids', trainerId);

    const queryString = params.toString();
    if (queryString) url += `?${queryString}`;

    downloadBtn.disabled = true;
    downloadBtn.textContent = '📥 Generating...';

    try {
      const response = await apiFetch(`/admin/reports/excel${queryString ? '?' + queryString : ''}`, { 
        responseType: 'blob' 
      });

      if (!response.ok) {
        throw new Error(`Report generation failed: ${response.statusText}`);
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = downloadUrl;
      
      const dateStr = new Date().toISOString().split('T')[0];
      a.download = `BLC_Report_${dateStr}.xlsx`;
      
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      a.remove();

    } catch (error) {
      console.error('Excel download error:', error);
      showToast('Could not download the report.', 'error');
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = '🚀 Download Excel';
      closeReportModal();
    }
  }
}

// Load unread notifications count
async function loadNotifCount() {
  // if (!getToken()) return; // No longer needed with HttpOnly cookies
  try {
    const notes = await apiFetch('/invoices/notifications/list');
    if (!notes) return;
    const unread = notes.filter(n => !n.is_read).length;
    const dot = document.getElementById('notif-dot');
    if (dot && unread > 0) dot.classList.add('show');
  } catch(e) {}
}

document.addEventListener('DOMContentLoaded', () => {
  const user = getUser();
  if (user) {
    populateSidebarUser();
    loadNotifCount();
    if (['admin', 'superadmin'].includes(user.role)) {
      initAdminReports();
    }
  }

  // Attach logout
  document.querySelectorAll('[data-action="logout"]').forEach(btn =>
    btn.addEventListener('click', logout)
  );

  // Mobile sidebar toggle
  const toggle  = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (toggle && sidebar && overlay) {
    const open  = () => { sidebar.classList.add('open');    overlay.classList.add('open'); };
    const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('open'); };
    toggle.addEventListener('click', () => sidebar.classList.contains('open') ? close() : open());
    overlay.addEventListener('click', close);
  }
});
