// Redirect if already logged in (based on user data in localStorage, token is HttpOnly)
(function() {
  const user = getUser();
  if (user) { // If user object exists, assume authenticated (token in HttpOnly cookie)
    if (['admin','superadmin'].includes(user.role)) {
      window.location.href = '/admin/dashboard.html';
    } else {
      window.location.href = '/trainer/dashboard.html';
    }
  }
})();

// Particles
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('particles');
    if (container) {
        for (let i = 0; i < 18; i++) {
            const p = document.createElement('div');
            p.className = 'particle';
            const size = Math.random() * 60 + 20;
            p.style.cssText = `
                width:${size}px; height:${size}px;
                left:${Math.random()*100}%;
                animation-duration:${Math.random()*15+10}s;
                animation-delay:${Math.random()*10}s;
                opacity:0;
            `;
            container.appendChild(p);
        }
    }

    // Toggle password
    const toggleBtn = document.getElementById('toggle-pw');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const pw = document.getElementById('password');
            pw.type = pw.type === 'password' ? 'text' : 'password';
            this.textContent = pw.type === 'password' ? '👁️' : '🔒';
        });
    }

    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email    = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const btn      = document.getElementById('login-btn');
            const alert    = document.getElementById('alert-box');

            alert.classList.add('hidden');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Signing in…';

            try {
                const data = await apiFetch('/auth/login', {
                    method: 'POST',
                    body: JSON.stringify({ email, password })
                });
                if (!data) return;
                saveSession(data.user);
                if (['admin','superadmin'].includes(data.user.role)) {
                    window.location.href = '/admin/dashboard.html';
                } else {
                    window.location.href = '/trainer/dashboard.html';
                }
            } catch (err) {
                alert.textContent = err.message || 'Login failed. Please try again.';
                alert.classList.remove('hidden');
                btn.disabled = false;
                btn.innerHTML = 'Sign In';
            }
        });
    }
});
