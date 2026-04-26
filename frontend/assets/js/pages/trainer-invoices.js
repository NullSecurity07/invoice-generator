requireAuth('trainer');

window.loadInvoices = async function() {
  const status = document.getElementById('filter-status').value;
  const url = status ? `/invoices?status=${status}` : '/invoices';
  
  try {
    const invoices = await apiFetch(url);
    const tbody = document.getElementById('invoices-body');
    tbody.innerHTML = '';
    
    if (invoices && invoices.length > 0) {
      invoices.forEach(inv => {
        const tr = document.createElement('tr');

        const invoiceNoCell = document.createElement('td');
        invoiceNoCell.className = 'fw-bold';
        invoiceNoCell.textContent = escapeHTML(inv.invoice_no);
        tr.appendChild(invoiceNoCell);

        const collegeCell = document.createElement('td');
        collegeCell.textContent = escapeHTML(inv.training_college || '—');
        tr.appendChild(collegeCell);

        const dateCell = document.createElement('td');
        dateCell.className = 'td-muted';
        dateCell.textContent = formatDate(inv.created_at);
        tr.appendChild(dateCell);

        const amountCell = document.createElement('td');
        amountCell.className = 'fw-bold text-accent';
        amountCell.textContent = formatINR(inv.total);
        tr.appendChild(amountCell);

        const statusCell = document.createElement('td');
        statusCell.innerHTML = statusBadge(inv.status);
        tr.appendChild(statusCell);

        const actionsCell = document.createElement('td');
        const actionsDiv = document.createElement('div');
        actionsDiv.style.display = 'flex';
        actionsDiv.style.gap = '5px';
        actionsDiv.style.flexWrap = 'wrap';

        const pdfButton = document.createElement('button');
        pdfButton.className = 'btn btn-ghost btn-sm';
        pdfButton.title = 'System PDF';
        pdfButton.style.fontSize = '0.7rem';
        pdfButton.style.padding = '4px';
        pdfButton.textContent = 'Gen PDF';
        pdfButton.onclick = () => downloadInvoicePDF(inv.id, inv.invoice_no);
        actionsDiv.appendChild(pdfButton);

        if (inv.status === 'draft') {
          const submitButton = document.createElement('button');
          submitButton.onclick = () => initSubmit(inv.id, inv.invoice_no);
          submitButton.className = 'btn btn-success btn-sm';
          submitButton.style.fontSize = '0.7rem';
          submitButton.style.padding = '4px';
          submitButton.textContent = 'Sign & Submit';
          actionsDiv.appendChild(submitButton);
        }
        
        actionsCell.appendChild(actionsDiv);
        tr.appendChild(actionsCell);

        tbody.appendChild(tr);
      });
    } else {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No invoices found.</td></tr>`;
    }
  } catch(e) {
    showToast('Error loading invoices', 'error');
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

let pendingSubmitId = null;

window.initSubmit = function(id, no) {
  pendingSubmitId = id;
  document.getElementById('ack-checkbox').checked = false;
  document.getElementById('ack-invoice-no').textContent = no;
  document.getElementById('ack-submit-btn').disabled = true;
  document.getElementById('ack-modal').classList.add('open');
}

window.toggleAckBlock = function() {
  document.getElementById('ack-submit-btn').disabled = !document.getElementById('ack-checkbox').checked;
}

window.closeAckModal = function() {
  document.getElementById('ack-modal').classList.remove('open');
  pendingSubmitId = null;
}

window.executeSubmit = async function() {
  if(!pendingSubmitId) return;
  const btn = document.getElementById('ack-submit-btn');
  btn.disabled = true;
  try {
    await apiFetch(`/invoices/${pendingSubmitId}/submit`, { method: 'POST' });
    showToast('Invoice securely signed and submitted', 'success');
    closeAckModal();
    loadInvoices();
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', loadInvoices);
