requireAuth('admin');

async function loadDashboard() {
  try {
    const stats = await apiFetch('/admin/stats');
    if(stats) {
      document.getElementById('stats-container').innerHTML = `
        <div class="stat-card purple">
          <div class="stat-icon">👥</div>
          <div class="stat-value">${stats.totalTrainers}</div>
          <div class="stat-label">Active Trainers</div>
        </div>
        <div class="stat-card yellow">
          <div class="stat-icon">⏳</div>
          <div class="stat-value">${stats.pendingReview}</div>
          <div class="stat-label">Pending Review</div>
        </div>
        <div class="stat-card blue">
          <div class="stat-icon">✅</div>
          <div class="stat-value">${stats.approved}</div>
          <div class="stat-label">Approved to Pay</div>
        </div>
        <div class="stat-card green">
          <div class="stat-icon">₹</div>
          <div class="stat-value" style="font-size:1.4rem; padding-bottom:6px;">${formatINR(stats.totalPaid)}</div>
          <div class="stat-label">Total Paid</div>
        </div>
      `;

      const rBody = document.getElementById('recent-invoices-body');
      if(stats.recentInvoices && stats.recentInvoices.length > 0) {
        rBody.innerHTML = stats.recentInvoices.slice(0,6).map(inv => `
          <tr>
            <td class="fw-bold"><a href="/admin/invoices.html?search=${escapeHTML(inv.invoice_no)}">${escapeHTML(inv.invoice_no)}</a></td>
            <td>${escapeHTML(inv.trainer_name)}</td>
            <td class="fw-bold text-accent">${formatINR(inv.total)}</td>
            <td>${statusBadge(escapeHTML(inv.status))}</td>
          </tr>
        `).join('');
        
        const pending = stats.recentInvoices.filter(i => i.status === 'submitted' || i.status === 'under_review');
        if(pending.length > 0) {
          document.getElementById('pending-action-body').innerHTML = `
            <div class="list-group">
              ${pending.map(inv => `
                <div style="padding:12px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between;">
                  <div>
                    <div class="fw-bold">${escapeHTML(inv.invoice_no)}</div>
                    <div class="text-muted" style="font-size:0.8rem;">From: ${escapeHTML(inv.trainer_name)}</div>
                  </div>
                  <a href="/admin/invoices.html?search=${escapeHTML(inv.invoice_no)}" class="btn btn-accent btn-sm">Review</a>
                </div>
              `).join('')}
            </div>
          `;
        }
      } else {
        rBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">No recent activity</td></tr>`;
      }
    }
  } catch(e) { showToast('Error loading stats', 'error'); }
}

async function loadAdminSignature() {
  try {
    const data = await apiFetch('/auth/me');
    if (data && data.signature_path) {
      document.getElementById('admin-sig-container').innerHTML = `<img src="/api/auth/signature-image/${escapeHTML(data.signature_path)}" style="max-height:90px;max-width:100%;object-fit:contain" />`;
    } else {
      document.getElementById('admin-sig-container').innerHTML = '<span class="text-muted" style="font-size:0.8rem">No signature uploaded</span>';
    }
  } catch(e) {}
}

window.uploadAdminSignature = async function(input) {
  if(!input.files[0]) return;
  const formData = new FormData();
  formData.append('signature', input.files[0]);
  try {
    const res = await fetch(API + '/auth/profile/signature', {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });
    if(res.ok) {
      showToast('Signature updated!', 'success');
      loadAdminSignature();
    } else {
      showToast('Upload failed', 'error');
    }
  } catch(e) { showToast('Error uploading signature', 'error'); }
}

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  loadAdminSignature();
});
