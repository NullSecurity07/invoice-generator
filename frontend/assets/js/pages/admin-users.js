requireAuth('admin');

let debounceTimer;
window.debounceLoad = function() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadUsers, 500);
}

window.loadUsers = async function() {
  const search = document.getElementById('search').value;
  const is_active = document.getElementById('is_active').value;
  let url = '/admin/users?role=trainer';
  if(search) url += `&search=${encodeURIComponent(search)}`;
  if(is_active) url += `&is_active=${is_active}`;

  try {
    const users = await apiFetch(url);
    const tbody = document.getElementById('users-body');
    tbody.innerHTML = '';
    if(users && users.length > 0) {
      users.forEach(u => {
        const tr = document.createElement('tr');
        
        const nameCell = document.createElement('td');
        nameCell.className = 'fw-bold';
        nameCell.textContent = escapeHTML(u.name);
        tr.appendChild(nameCell);
        
        const emailCell = document.createElement('td');
        emailCell.className = 'td-muted';
        emailCell.textContent = escapeHTML(u.email);
        tr.appendChild(emailCell);

        const bankCell = document.createElement('td');
        bankCell.className = 'td-muted';
        bankCell.innerHTML = u.bank_account ? `<span class="text-success">Added ✅</span>` : `<span class="text-warning">Missing ⚠️</span>`;
        tr.appendChild(bankCell);
        
        const paidCell = document.createElement('td');
        paidCell.className = 'fw-bold text-success';
        paidCell.textContent = formatINR(u.total_paid || 0);
        tr.appendChild(paidCell);
        
        const pendingCell = document.createElement('td');
        pendingCell.className = 'text-warning';
        pendingCell.textContent = formatINR(u.total_pending || 0);
        tr.appendChild(pendingCell);
        
        const statusCell = document.createElement('td');
        statusCell.innerHTML = u.is_active ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>';
        tr.appendChild(statusCell);
        
        const actionsCell = document.createElement('td');
        const toggleButton = document.createElement('button');
        toggleButton.className = 'btn btn-ghost btn-sm';
        toggleButton.textContent = u.is_active ? 'Deactivate' : 'Reactivate';
        toggleButton.onclick = () => toggleActive(u.id, u.is_active);
        actionsCell.appendChild(toggleButton);
        tr.appendChild(actionsCell);

        tbody.appendChild(tr);
      });
    } else { tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No trainers found</td></tr>`; }
  } catch(e) { showToast('Error loading users', 'error'); }
}

window.openModal = function(id) { document.getElementById(id).classList.add('open'); }
window.closeModal = function(id) { document.getElementById(id).classList.remove('open'); }

window.generatePassword = function() {
  const length = 12;
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
  let password = "";
  for (let i = 0, n = charset.length; i < length; ++i) {
      password += charset.charAt(Math.floor(Math.random() * n));
  }
  document.getElementById('c_password').value = password;
}

document.getElementById('create-form').addEventListener('submit', async(e) => {
  e.preventDefault();
  const btn = document.getElementById('c_submit');
  btn.disabled = true;
  try {
    await apiFetch('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('c_name').value,
        email: document.getElementById('c_email').value,
        phone: document.getElementById('c_phone').value,
        password: document.getElementById('c_password').value,
        role: 'trainer'
      })
    });
    showToast('Trainer account created successfully', 'success');
    closeModal('create-trainer-modal');
    e.target.reset();
    loadUsers();
  } catch(e) { showToast(e.message, 'error'); }
  finally { btn.disabled = false; }
});

window.toggleActive = async function(id, current) {
  if(!await confirmAction(`Are you sure you want to ${current ? 'deactivate' : 'reactivate'} this trainer?`)) return;
  try {
    await apiFetch(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: current ? 0 : 1 }) });
    showToast(`Trainer ${current ? 'deactivated' : 'reactivated'}`, 'success');
    loadUsers();
  } catch(e) { showToast(e.message, 'error'); }
}

document.addEventListener('DOMContentLoaded', loadUsers);
