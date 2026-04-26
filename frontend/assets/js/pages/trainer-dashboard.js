requireAuth('trainer');

async function loadDashboard() {
  try {
    const stats = await apiFetch('/invoices/stats/me');
    if (stats) {
      document.getElementById('stats-container').innerHTML = `
        <div class="stat-card blue">
          <div class="stat-icon">📄</div>
          <div class="stat-value">${stats.total}</div>
          <div class="stat-label">Total Invoices</div>
        </div>
        <div class="stat-card yellow">
          <div class="stat-icon">⏳</div>
          <div class="stat-value">${stats.pending}</div>
          <div class="stat-label">Pending Approval</div>
        </div>
        <div class="stat-card green">
          <div class="stat-icon">₹</div>
          <div class="stat-value" style="font-size:1.4rem; padding-bottom:6px;">${formatINR(stats.totalEarnings)}</div>
          <div class="stat-label">Total Earnings</div>
        </div>
        <div class="stat-card red">
          <div class="stat-icon">💳</div>
          <div class="stat-value" style="font-size:1.4rem; padding-bottom:6px;">${formatINR(stats.pendingAmt)}</div>
          <div class="stat-label">Pending Payment</div>
        </div>
      `;
    }

    const invoices = await apiFetch('/invoices');
    const tbody = document.getElementById('recent-invoices-body');
    if (invoices && invoices.length > 0) {
      const recent = invoices.slice(0, 5);
      tbody.innerHTML = recent.map(inv => `
        <tr>
          <td class="fw-bold">${escapeHTML(inv.invoice_no)}</td>
          <td class="td-muted">${formatDate(inv.created_at)}</td>
          <td class="fw-bold text-accent">${formatINR(inv.total)}</td>
          <td>${statusBadge(inv.status)}</td>
          <td>
            <button onclick="downloadInvoicePDF(${inv.id}, '${inv.invoice_no}')" class="btn btn-ghost btn-sm">PDF</button>
          </td>
        </tr>
      `).join('');
    } else {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">No invoices found. Get started by creating one!</td></tr>`;
    }
  } catch (err) {
    console.error(err);
    showToast('Error loading dashboard data', 'error');
  }
}

window.downloadInvoicePDF = async function(invoiceId, invoiceNo) {
  try {
    const response = await apiFetch(`/invoices/${invoiceId}/pdf`, { responseType: 'blob' });
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = downloadUrl;
    a.download = `${invoiceNo}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    a.remove();
  } catch (error) {
    console.error('PDF download error:', error);
    showToast('Could not download the PDF.', 'error');
  }
}

document.addEventListener('DOMContentLoaded', loadDashboard);
