requireAuth('trainer');
let rowCount = 0;

async function checkProfile() {
  try {
    const { profile } = await apiFetch('/auth/me');
    if (!profile || !profile.bank_account || !profile.pan) {
      document.getElementById('profile-warning').classList.remove('hidden');
    }
  } catch(e) {}
}

window.addRow = function() {
  if (rowCount >= 5) {
    showToast('Maximum 5 line items allowed', 'warning');
    return;
  }
  rowCount++;
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="text-center fw-bold">${rowCount}</td>
    <td><input type="text" class="form-control item-particulars" placeholder="Topic / Subject" value="${escapeHTML("")}" required minlength="3"></td>
    <td><input type="text" class="form-control item-dates" placeholder="DD-MM-YYYY" value="${escapeHTML("")}"></td>
    <td><input type="text" class="form-control item-hours" placeholder="e.g. 4 hrs" value="${escapeHTML("")}"></td>
    <td><input type="number" class="form-control item-rate" step="0.01" min="0" placeholder="0.00" oninput="calculate()" value="0" required></td>
    <td><input type="number" class="form-control item-qty" step="0.01" min="0.1" value="1" oninput="calculate()" required></td>
    <td class="item-total" data-amt="0">₹ 0.00</td>
    <td class="text-center"><button type="button" class="btn-icon" onclick="removeRow(this)">🗑️</button></td>
  `;
  document.getElementById('items-body').appendChild(tr);
  updateRowNumbers();
  calculate(); // Recalculate after adding row
}

window.removeRow = function(btn) {
  if (document.querySelectorAll('#items-body tr').length <= 1) return;
  btn.closest('tr').remove();
  rowCount--;
  updateRowNumbers();
  calculate();
}

function updateRowNumbers() {
  const rows = document.querySelectorAll('#items-body tr');
  rows.forEach((row, i) => { row.cells[0].textContent = i + 1; });
}

window.calculate = function() {
  let subtotal = 0;
  document.querySelectorAll('#items-body tr').forEach(row => {
    const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
    const qty  = parseFloat(row.querySelector('.item-qty').value) || 0;
    const amt  = rate * qty;
    row.querySelector('.item-total').textContent = formatINR(amt);
    row.querySelector('.item-total').dataset.amt = amt;
    subtotal += amt;
  });

  const total = subtotal;

  document.getElementById('calc-subtotal').textContent = formatINR(subtotal);
  document.getElementById('calc-total').textContent = formatINR(total);
}

document.getElementById('add-row-btn').addEventListener('click', addRow);

async function saveInvoice(status) {
  const items = [];
  document.querySelectorAll('#items-body tr').forEach(row => {
    items.push({
      particulars: row.querySelector('.item-particulars').value,
      dates: row.querySelector('.item-dates').value,
      hours_days: row.querySelector('.item-hours').value,
      rate: row.querySelector('.item-rate').value,
      qty: row.querySelector('.item-qty').value
    });
  });

  if (items.length === 0) {
    showToast('Please add at least one item', 'error'); return;
  }

  const payload = {
    training_college: document.getElementById('training_college').value,
    training_period: document.getElementById('training_period').value,
    po_wo_no: document.getElementById('po_wo_no').value,
    place_of_supply: document.getElementById('place_of_supply').value,
    remarks: document.getElementById('remarks').value,
    status: status,
    items: items
  };

  try {
    const res = await apiFetch('/invoices', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res) {
      showToast(`Invoice ${status === 'draft' ? 'saved as draft' : 'submitted'} successfully!`, 'success');
      setTimeout(() => window.location.href = '/trainer/invoices.html', 1500);
    }
  } catch(e) {
    showToast(e.message, 'error');
  }
}

document.getElementById('save-draft-btn').addEventListener('click', () => {
  if(document.getElementById('invoice-form').checkValidity()) {
    saveInvoice('draft');
  } else {
    document.getElementById('invoice-form').reportValidity();
  }
});

document.getElementById('invoice-form').addEventListener('submit', (e) => {
  e.preventDefault();
  saveInvoice('submitted');
});

document.addEventListener('DOMContentLoaded', () => {
  checkProfile();
  loadColleges();
  addRow(); // add initial row
  calculate(); // ensure initial calculation
});

async function loadColleges() {
  try {
    const colleges = await apiFetch('/invoices/colleges');
    const select = document.getElementById('training_college');
    if (colleges && colleges.length > 0) {
      colleges.forEach(c => {
        const option = document.createElement('option');
        option.value = c.name;
        option.textContent = c.name;
        select.appendChild(option);
      });
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.disabled = true;
      option.textContent = 'No colleges available. Administrator must add one.';
      select.appendChild(option);
    }
  } catch (err) {
    console.error('Failed to load colleges:', err);
  }
}
