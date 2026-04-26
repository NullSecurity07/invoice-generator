document.addEventListener('DOMContentLoaded', () => {
  requireAuth('admin');

  const me = getUser();
  if (me) {
      document.getElementById('sidebar-user-name').textContent = me.name;
      document.getElementById('sidebar-avatar').textContent = me.name.charAt(0).toUpperCase();
  }

  const tbody = document.getElementById('colleges-body');
  const form = document.getElementById('add-college-form');

  async function loadColleges() {
      try {
          const colleges = await apiFetch('/admin/colleges');
          if (!colleges || colleges.length === 0) {
              tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No colleges added yet.</td></tr>';
              return;
          }

          tbody.innerHTML = '';
          colleges.forEach(c => {
              const tr = document.createElement('tr');
              tr.innerHTML = `
                  <td style="font-weight: 500;">${c.name}</td>
                  <td>${new Date(c.created_at).toLocaleDateString()}</td>
                  <td>
                      <button class="btn btn-ghost btn-sm text-danger" onclick="deleteCollege(${c.id}, '${c.name.replace(/'/g, "\\'")}')">Remove</button>
                  </td>
              `;
              tbody.appendChild(tr);
          });
      } catch (err) {
          tbody.innerHTML = `<tr><td colspan="3" class="text-center" style="color:var(--danger)">Error: ${err.message}</td></tr>`;
      }
  }

  form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('new_college_name');
      const name = input.value.trim();
      if (!name) return;

      try {
          const btn = form.querySelector('button');
          btn.textContent = 'Adding...';
          btn.disabled = true;

          await apiFetch('/admin/colleges', {
              method: 'POST',
              body: JSON.stringify({ name })
          });

          input.value = '';
          loadColleges();
      } catch (err) {
          alert('Failed to add college: ' + err.message);
      } finally {
          const btn = form.querySelector('button');
          btn.textContent = 'Add College';
          btn.disabled = false;
      }
  });

  window.deleteCollege = async (id, name) => {
      if (!confirm(`Are you sure you want to remove "${name}"? Trainers will no longer be able to select it.`)) return;
      try {
          await apiFetch(`/admin/colleges/${id}`, { method: 'DELETE' });
          loadColleges();
      } catch (err) {
          alert('Failed to delete: ' + err.message);
      }
  };

  loadColleges();
});
