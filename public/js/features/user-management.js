/**
 * User Management feature.
 * Admin: full access — create, edit, disable/enable, delete, assign any role.
 * Owner: can create and edit users (farmer/owner roles only), disable accounts.
 *        Cannot delete users or assign/modify admin accounts.
 * Farmer: no access to this page (hidden by RBAC guards in app.js).
 */
import {
  fbFirestore,
  fbDoc,
  fbSetDoc,
  fbGetDocs,
  fbCollection,
  fbServerTimestamp,
  fbGetIdToken,
} from '../firebase-client.js';

// Canonical role values
const ROLES = ['admin', 'owner', 'farmer'];

// Display labels
const ROLE_LABEL = { admin: 'Admin', owner: 'Owner', farmer: 'Farmer' };

let allUsers = [];
let currentUserRole = 'farmer';
let currentUserId = null;
// Tracks UIDs deleted in this session so they're filtered out even on re-fetch
const deletedIds = new Set();

export function setCurrentUser(uid, role) {
  currentUserId = uid;
  currentUserRole = role;
}

export function init() {
  document.getElementById('um-search')?.addEventListener('input', renderTable);
  document.getElementById('um-filter-role')?.addEventListener('change', renderTable);
  document.getElementById('btn-add-user')?.addEventListener('click', () => {
    const perms = window._rbacPerms || {};
    if (!perms.canManageUsers) {
      alert('Access denied: Owner or Admin required to create users.');
      return;
    }
    openUserModal(null);
  });
}

export async function loadUsers() {
  try {
    const snap = await fbGetDocs(fbCollection(fbFirestore(), 'users'));
    allUsers = snap.docs
      .map((d) => {
        const data = d.data();
        if (data.role === 'manager') data.role = 'owner';
        if (data.role === 'viewer')  data.role = 'farmer';
        return { id: d.id, ...data };
      })
      .filter((u) => !deletedIds.has(u.id)); // exclude any locally-deleted users
    updateStats();
    renderTable();
  } catch (e) {
    console.error('[UserMgmt] Failed to load users:', e);
  }
}

function updateStats() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('um-count-total',   allUsers.length);
  set('um-count-admin',   allUsers.filter((u) => u.role === 'admin').length);
  set('um-count-manager', allUsers.filter((u) => u.role === 'owner').length);
  set('um-count-viewer',  allUsers.filter((u) => u.role === 'farmer').length);
}

function renderTable() {
  const tbody = document.getElementById('um-tbody');
  if (!tbody) return;

  const search     = (document.getElementById('um-search')?.value || '').toLowerCase();
  const roleFilter = document.getElementById('um-filter-role')?.value || '';

  const filtered = allUsers.filter((u) => {
    const matchSearch = !search ||
      (u.displayName || '').toLowerCase().includes(search) ||
      (u.email || '').toLowerCase().includes(search);
    const matchRole = !roleFilter || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="um-empty">No users found.</td></tr>`;
    return;
  }

  const isAdmin   = currentUserRole === 'admin';
  const isOwner   = currentUserRole === 'owner';
  const canManage = isAdmin || isOwner;

  tbody.innerHTML = filtered.map((u) => {
    const name     = u.displayName || u.email?.split('@')[0] || 'User';
    const email    = u.email || '—';
    const role     = u.role || 'farmer';
    const status   = u.status || 'active';
    const joined   = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : '—';
    const letter   = (name[0] || 'U').toUpperCase();
    const isSelf   = u.id === currentUserId;
    const disabled = status !== 'active';
    // Owners cannot manage admin accounts
    const targetIsAdmin = role === 'admin';
    const ownerCanAct   = isOwner && !targetIsAdmin && !isSelf;

    const statusBadge = disabled
      ? `<span class="badge-pill status-warning">Disabled</span>`
      : `<span class="badge-pill status-normal">Active</span>`;

    const editBtn = (isAdmin || ownerCanAct)
      ? `<button class="um-btn-icon" title="Edit user" data-action="edit" data-uid="${u.id}">
           <svg class="icon icon-14"><use href="#icon-edit"/></svg>
         </button>`
      : '';

    const toggleBtn = ((isAdmin && !isSelf) || ownerCanAct)
      ? `<button class="um-btn-icon${disabled ? ' success' : ' warn'}" title="${disabled ? 'Enable account' : 'Disable account'}" data-action="toggle" data-uid="${u.id}" data-disabled="${disabled}">
           <svg class="icon icon-14"><use href="${disabled ? '#icon-check-circle' : '#icon-ban'}"/></svg>
         </button>`
      : '';

    // Only admins can delete; owners cannot
    const deleteBtn = (isAdmin && !isSelf)
      ? `<button class="um-btn-icon danger" title="Delete user" data-action="delete" data-uid="${u.id}">
           <svg class="icon icon-14"><use href="#icon-trash"/></svg>
         </button>`
      : '';

    return `
      <tr style="${disabled ? 'opacity:0.6;' : ''}">
        <td>
          <div class="um-user-cell">
            <div class="um-avatar">${letter}</div>
            <div>
              <div class="um-user-name">${esc(name)}${isSelf ? ' <span style="font-size:0.7rem;color:var(--text-faint)">(you)</span>' : ''}</div>
              <div class="um-user-email">${esc(email)}</div>
            </div>
          </div>
        </td>
        <td><span class="um-role-badge um-role-${role}">${ROLE_LABEL[role] || role}</span></td>
        <td>${statusBadge}</td>
        <td style="color:var(--text-muted);font-size:0.82rem;">${joined}</td>
        <td><div class="um-actions">${editBtn}${toggleBtn}${deleteBtn}</div></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid    = btn.getAttribute('data-uid');
      const action = btn.getAttribute('data-action');
      const user   = allUsers.find((u) => u.id === uid);
      if (!user) return;
      if (action === 'edit')   openUserModal(user);
      if (action === 'toggle') confirmToggle(user);
      if (action === 'delete') confirmDelete(user);
    });
  });
}

function esc(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ─── Create / Edit modal ──────────────────────────────────────────────────────

function openUserModal(user) {
  const isEdit    = !!user;
  const isAdmin   = currentUserRole === 'admin';
  const isOwner   = currentUserRole === 'owner';

  // Owners can only assign farmer or owner roles (not admin)
  const assignableRoles = isAdmin ? ROLES : ROLES.filter((r) => r !== 'admin');

  const dlg = document.createElement('dialog');
  dlg.className = 'um-modal';

  dlg.innerHTML = `
    <div class="um-modal-inner">
      <div class="um-modal-head">
        <div>
          <div class="um-modal-title">${isEdit ? 'Edit User' : 'Add New User'}</div>
          <div class="um-modal-sub">${isEdit ? 'Update user details and role.' : 'Create a new user account.'}</div>
        </div>
        <button class="um-modal-close" id="um-dlg-close" type="button" aria-label="Close">
          <svg class="icon icon-16"><use href="#icon-x"/></svg>
        </button>
      </div>

      <div class="um-form-grid">
        <div class="um-field">
          <label>Display Name</label>
          <input id="um-f-name" type="text" placeholder="John Doe" value="${esc(user?.displayName || '')}" />
        </div>
        <div class="um-field">
          <label>Phone</label>
          <input id="um-f-phone" type="text" placeholder="+1 555 000 0000" value="${esc(user?.phone || '')}" />
        </div>
        <div class="um-field full">
          <label>Email Address</label>
          <input id="um-f-email" type="email" placeholder="user@company.com"
            value="${esc(user?.email || '')}"
            ${isEdit ? 'readonly style="opacity:0.6;cursor:not-allowed;"' : ''} />
        </div>
        ${!isEdit ? `
        <div class="um-field full">
          <label>Temporary Password</label>
          <input id="um-f-password" type="password" placeholder="Min. 8 characters" />
        </div>` : ''}
        <div class="um-field">
          <label>Role</label>
          <select id="um-f-role">
            ${assignableRoles.map((r) => `<option value="${r}" ${(user?.role || 'farmer') === r ? 'selected' : ''}>${ROLE_LABEL[r] || r}</option>`).join('')}
          </select>
        </div>
        <div class="um-field full">
          <label>Farm ID <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-faint)">(optional)</span></label>
          <input id="um-f-farmid" type="text" placeholder="e.g. farm001" value="${esc(user?.farmId || '')}" />
        </div>
      </div>

      <div id="um-dlg-error" class="um-error"></div>

      <div class="um-modal-footer">
        <button type="button" class="btn btn-outline" id="um-dlg-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="um-dlg-save">${isEdit ? 'Save Changes' : 'Create User'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(dlg);
  dlg.showModal();

  const close = () => { dlg.close(); setTimeout(() => dlg.remove(), 0); };
  dlg.querySelector('#um-dlg-close')?.addEventListener('click', close);
  dlg.querySelector('#um-dlg-cancel')?.addEventListener('click', close);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));

  dlg.querySelector('#um-dlg-save')?.addEventListener('click', async () => {
    const errEl  = dlg.querySelector('#um-dlg-error');
    const name   = dlg.querySelector('#um-f-name')?.value.trim() || '';
    const phone  = dlg.querySelector('#um-f-phone')?.value.trim() || '';
    const email  = dlg.querySelector('#um-f-email')?.value.trim() || '';
    const role   = dlg.querySelector('#um-f-role')?.value || 'farmer';
    const farmId = dlg.querySelector('#um-f-farmid')?.value.trim() || '';

    if (!email) { showErr(errEl, 'Email is required.'); return; }
    if (!isEdit && !dlg.querySelector('#um-f-password')?.value) {
      showErr(errEl, 'Password is required for new users.'); return;
    }

    // Owners cannot assign admin role
    if (!isAdmin && role === 'admin') {
      showErr(errEl, 'Only Admins can assign the Admin role.'); return;
    }

    const saveBtn = dlg.querySelector('#um-dlg-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      if (isEdit) {
        await fbSetDoc(
          fbDoc(fbFirestore(), 'users', user.id),
          { displayName: name, phone, role, farmId, updatedAt: fbServerTimestamp() },
          { merge: true },
        );
        const idx = allUsers.findIndex((u) => u.id === user.id);
        if (idx !== -1) allUsers[idx] = { ...allUsers[idx], displayName: name, phone, role, farmId };
      } else {
        const password = dlg.querySelector('#um-f-password')?.value || '';
        const token = await fbGetIdToken();
        const resp = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ email, password, displayName: name || email.split('@')[0], phone, role, farmId }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to create user.');
        allUsers.push({ id: data.uid, email, displayName: name || email.split('@')[0], phone, role, status: 'active', farmId });
      }
      updateStats();
      renderTable();
      close();
    } catch (e) {
      showErr(errEl, 'Save failed: ' + (e?.message || String(e)));
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Create User';
    }
  });
}

// ─── Disable / Enable confirmation ───────────────────────────────────────────

function confirmToggle(user) {
  const isDisabled = user.status !== 'active';
  const action     = isDisabled ? 'Enable' : 'Disable';
  const name       = user.displayName || user.email || 'this user';

  const dlg = document.createElement('dialog');
  dlg.className = 'um-modal';
  dlg.innerHTML = `
    <div class="um-modal-inner">
      <div class="um-modal-head">
        <div>
          <div class="um-modal-title">${action} Account</div>
          <div class="um-modal-sub">${isDisabled ? 'The user will be able to log in again.' : 'The user will be blocked from logging in.'}</div>
        </div>
        <button class="um-modal-close" id="ct-close" type="button" aria-label="Close">
          <svg class="icon icon-16"><use href="#icon-x"/></svg>
        </button>
      </div>
      <p style="font-size:0.9rem;color:var(--text-2);margin-bottom:20px;">
        ${isDisabled
          ? `Re-enable <strong>${esc(name)}</strong>? They will be able to sign in immediately.`
          : `Disable <strong>${esc(name)}</strong>? They will be signed out and blocked from logging in.`}
      </p>
      <div id="ct-error" class="um-error"></div>
      <div class="um-modal-footer">
        <button type="button" class="btn btn-outline" id="ct-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="ct-confirm"
          style="${isDisabled ? '' : 'background:var(--orange,#f59e0b);border-color:var(--orange,#f59e0b);'}">
          ${action}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();

  const close = () => { dlg.close(); setTimeout(() => dlg.remove(), 0); };
  dlg.querySelector('#ct-close')?.addEventListener('click', close);
  dlg.querySelector('#ct-cancel')?.addEventListener('click', close);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));

  dlg.querySelector('#ct-confirm')?.addEventListener('click', async () => {
    const errEl = dlg.querySelector('#ct-error');
    const btn   = dlg.querySelector('#ct-confirm');
    btn.disabled = true;
    btn.textContent = `${action}ing…`;
    try {
      const token = await fbGetIdToken();
      const resp = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ disabled: !isDisabled }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Request failed.');
      const idx = allUsers.findIndex((u) => u.id === user.id);
      if (idx !== -1) allUsers[idx].status = isDisabled ? 'active' : 'inactive';
      updateStats();
      renderTable();
      close();
    } catch (e) {
      showErr(errEl, `Failed: ${e?.message || String(e)}`);
      btn.disabled = false;
      btn.textContent = action;
    }
  });
}

// ─── Delete confirmation ──────────────────────────────────────────────────────

function confirmDelete(user) {
  const name = user.displayName || user.email || 'this user';
  const dlg  = document.createElement('dialog');
  dlg.className = 'um-modal';
  dlg.innerHTML = `
    <div class="um-modal-inner">
      <div class="um-modal-head">
        <div>
          <div class="um-modal-title">Delete User</div>
          <div class="um-modal-sub">This permanently removes the account and cannot be undone.</div>
        </div>
        <button class="um-modal-close" id="cd-close" type="button" aria-label="Close">
          <svg class="icon icon-16"><use href="#icon-x"/></svg>
        </button>
      </div>
      <p style="font-size:0.9rem;color:var(--text-2);margin-bottom:20px;">
        Permanently delete <strong>${esc(name)}</strong>? Their Firebase Auth account and all records will be removed.
      </p>
      <div id="cd-error" class="um-error"></div>
      <div class="um-modal-footer">
        <button type="button" class="btn btn-outline" id="cd-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="cd-confirm" style="background:var(--red);border-color:var(--red);">Delete</button>
      </div>
    </div>
  `;
  document.body.appendChild(dlg);
  dlg.showModal();

  const close = () => { dlg.close(); setTimeout(() => dlg.remove(), 0); };
  dlg.querySelector('#cd-close')?.addEventListener('click', close);
  dlg.querySelector('#cd-cancel')?.addEventListener('click', close);
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));

  dlg.querySelector('#cd-confirm')?.addEventListener('click', async () => {
    const errEl = dlg.querySelector('#cd-error');
    const btn   = dlg.querySelector('#cd-confirm');
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      const token = await fbGetIdToken();
      const resp = await fetch(`/api/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Request failed.');
      // Track deletion so re-fetches don't resurrect the user before Firestore propagates
      deletedIds.add(user.id);
      allUsers = allUsers.filter((u) => u.id !== user.id);
      updateStats();
      renderTable();
      close();
      // Re-fetch from Firestore in the background to confirm server-side deletion
      loadUsers();
    } catch (e) {
      showErr(errEl, `Failed: ${e?.message || String(e)}`);
      btn.disabled = false;
      btn.textContent = 'Delete';
    }
  });
}

function showErr(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}
