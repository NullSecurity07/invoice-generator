requireAuth('admin');

let debounceTimer;
window.debounceLoad = function() { clearTimeout(debounceTimer); debounceTimer = setTimeout(loadInvoices, 500); }

window.togglePaymentFields = function() {
  const val = document.getElementById('s_status').value;
  const pf = document.getElementById('payment-fields');
  const dateInput = document.getElementById('s_date');
  const refInput = document.getElementById('s_ref');
  
  if(val === 'paid') { 
    pf.classList.remove('hidden'); 
    dateInput.required = true; 
    refInput.required = true;
  } else { 
    pf.classList.add('hidden'); 
    dateInput.required = false; 
    refInput.required = false;
  }
  
  const remarks = document.getElementById('s_remarks');
  if(val === 'rejected') { remarks.required = true; remarks.minLength = 5; }
  else { remarks.required = false; remarks.minLength = 0; }
}

window.loadInvoices = async function() {
  const search = document.getElementById('search').value;
  const from = document.getElementById('from').value;
  const to = document.getElementById('to').value;
  
  const urlParams = new URLSearchParams(window.location.search);
  const qSearch = urlParams.get('search');
  if(qSearch && !search) document.getElementById('search').value = qSearch;
  
  const finalSearch = document.getElementById('search').value;
  const status = document.getElementById('status').value;
  
  let url = '/admin/invoices?';
  if(finalSearch) url += `search=${encodeURIComponent(finalSearch)}&`;
  if(status) url += `status=${status}&`;
  if(from) url += `from=${from}&`;
  if(to) url += `to=${to}&`;

  try {
    const invoices = await apiFetch(url);
    const tbody = document.getElementById('invoices-body');
    tbody.innerHTML = '';
    if(invoices && invoices.length > 0) {
      invoices.forEach(inv => {
        const tr = document.createElement('tr');

        const invoiceNoCell = document.createElement('td');
        invoiceNoCell.className = 'fw-bold';
        invoiceNoCell.textContent = escapeHTML(inv.invoice_no);
        tr.appendChild(invoiceNoCell);

        const trainerCell = document.createElement('td');
        const trainerName = document.createElement('div');
        trainerName.textContent = escapeHTML(inv.trainer_name);
        trainerCell.appendChild(trainerName);
        const trainerEmail = document.createElement('div');
        trainerEmail.className = 'text-muted';
        trainerEmail.style.fontSize = '0.75rem';
        trainerEmail.textContent = escapeHTML(inv.trainer_email);
        trainerCell.appendChild(trainerEmail);
        tr.appendChild(trainerCell);

        const dateCell = document.createElement('td');
        dateCell.className = 'td-muted';
        dateCell.textContent = inv.submitted_at ? formatDate(inv.submitted_at) : formatDate(inv.created_at);
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

        const updateButton = document.createElement('button');
        updateButton.className = 'btn btn-ghost btn-sm';
        updateButton.textContent = 'Update';
        updateButton.onclick = () => openStatusModal(inv.id, inv.invoice_no, inv.status, inv.remarks || '', inv.tds_applicable);
        actionsDiv.appendChild(updateButton);

        const pdfButton = document.createElement('button');
        pdfButton.className = 'btn btn-ghost btn-sm';
        pdfButton.textContent = 'PDF';
        pdfButton.onclick = () => downloadInvoicePDF(inv.id, inv.invoice_no);
        actionsDiv.appendChild(pdfButton);
        
        actionsCell.appendChild(actionsDiv);
        tr.appendChild(actionsCell);

        tbody.appendChild(tr);
      });
    } else { tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No invoices found</td></tr>`; }
  } catch(e) { showToast('Error fetching invoices', 'error'); }
}

window.openStatusModal = function(id, no, currentStatus, remarks, tds_applicable) {
  if(currentStatus === 'draft') { showToast('Cannot update draft invoices', 'warning'); return; }
  document.getElementById('s_id').value = id;
  document.getElementById('status-modal-title').textContent = `Update ${no}`;
  document.getElementById('s_status').value = ['draft','submitted'].includes(currentStatus) ? 'under_review' : currentStatus;
  document.getElementById('s_remarks').value = remarks || '';
  document.getElementById('s_tds').checked = !!tds_applicable;
  togglePaymentFields();
  document.getElementById('status-modal').classList.add('open');
}

window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); }

document.getElementById('status-form').addEventListener('submit', async(e) => {
  e.preventDefault();
  const btn = document.getElementById('s_submit');
  btn.disabled = true;
  try {
    const status = document.getElementById('s_status').value;
    const remarks = document.getElementById('s_remarks').value;
    if (status === 'rejected' && remarks.trim().length < 5) {
      showToast('Please provide a reason for rejection (min 5 chars)', 'warning');
      btn.disabled = false;
      return;
    }

    await apiFetch(`/admin/invoices/${document.getElementById('s_id').value}/status`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: status,
        remarks: remarks,
        payment_date: document.getElementById('s_date').value,
        reference_number: document.getElementById('s_ref').value,
        apply_tds: document.getElementById('s_tds').checked
      })
    });
    showToast('Status updated + notification sent!', 'success');
    closeModal('status-modal');
    loadInvoices();
  } catch(err) { showToast(err.message, 'error'); }
  finally { btn.disabled = false; }
});

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

document.addEventListener('DOMContentLoaded', loadInvoices);
