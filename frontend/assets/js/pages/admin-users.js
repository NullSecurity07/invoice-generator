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
        actionsCell.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

        const resetPwBtn = document.createElement('button');
        resetPwBtn.className = 'btn btn-ghost btn-sm';
        resetPwBtn.textContent = 'Reset Password';
        resetPwBtn.onclick = () => openResetPasswordModal(u.id, u.name);
        actionsCell.appendChild(resetPwBtn);

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

function generateSecurePassword() {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
  const array = new Uint8Array(12);
  crypto.getRandomValues(array);
  return Array.from(array, b => charset[b % charset.length]).join('');
}

window.generatePassword = function() {
  document.getElementById('c_password').value = generateSecurePassword();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('rp_generate_btn').addEventListener('click', () => {
    document.getElementById('rp_password').value = generateSecurePassword();
  });
});

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

window.openResetPasswordModal = function(id, name) {
  document.getElementById('rp_trainer_id').value = id;
  document.getElementById('rp_trainer_name').textContent = name;
  document.getElementById('rp_password').value = '';
  openModal('reset-password-modal');
}

document.getElementById('reset-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('rp_trainer_id').value;
  const password = document.getElementById('rp_password').value;
  const btn = document.getElementById('rp_submit');
  btn.disabled = true;
  try {
    await apiFetch(`/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    showToast('Password reset successfully', 'success');
    closeModal('reset-password-modal');
  } catch(e) { showToast(e.message || 'Failed to reset password', 'error'); }
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
