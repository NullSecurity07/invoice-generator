requireAuth('trainer');

async function loadProfile() {
  try {
    const data = await apiFetch('/auth/me');
    if(data) {
      document.getElementById('name').value = data.name || '';
      document.getElementById('email').value = data.email || '';
      document.getElementById('phone').value = data.phone || '';
      
      if(data.profile) {
        const p = data.profile;
        document.getElementById('pan').value = p.pan || '';
        document.getElementById('address').value = p.address || '';
        document.getElementById('bank_account_name').value = p.bank_account_name || '';
        document.getElementById('bank_name').value = p.bank_name || '';
        document.getElementById('bank_account').value = p.bank_account || '';
        document.getElementById('ifsc').value = p.ifsc || '';
        document.getElementById('branch').value = p.branch || '';
      }
      
      if(data.signature_path) {
        document.getElementById('sig-preview-container').innerHTML = `<img src="/api/auth/signature-image/${escapeHTML(data.signature_path)}" style="max-height:90px;max-width:100%;object-fit:contain" />`;
      }
    }
  } catch(e) {
    showToast('Error loading profile', 'error');
  }
}

window.uploadSignature = async function(input) {
  if(!input.files[0]) return;
  const formData = new FormData();
  formData.append('signature', input.files[0]);
  try {
    const res = await fetch(API + '/auth/profile/signature', {
      method: 'POST',
      body: formData,
      credentials: 'include' // Important for session cookies
    });
    if(res.ok) {
      showToast('Signature uploaded successfully!', 'success');
      loadProfile();
    } else {
      const err = await res.json();
      showToast(err.error || 'Upload failed', 'error');
    }
  } catch(e) {
    showToast('Error uploading signature', 'error');
  }
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  
  const payload = {
    name: document.getElementById('name').value,
    phone: document.getElementById('phone').value,
    pan: document.getElementById('pan').value,
    address: document.getElementById('address').value,
    bank_account_name: document.getElementById('bank_account_name').value,
    bank_name: document.getElementById('bank_name').value,
    bank_account: document.getElementById('bank_account').value,
    ifsc: document.getElementById('ifsc').value,
    branch: document.getElementById('branch').value
  };

  try {
    await apiFetch('/auth/profile', { method: 'PUT', body: JSON.stringify(payload) });
    const user = getUser();
    user.name = payload.name;
    saveSession(user); // Updated to match implementation in api.js if needed or logic
    if (typeof populateSidebarUser === 'function') populateSidebarUser();
    showToast('Profile updated successfully', 'success');
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener('DOMContentLoaded', loadProfile);
