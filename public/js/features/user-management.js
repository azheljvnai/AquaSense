/**
 * User Management feature.
 * Admin: full access — create, edit, reset password, disable/enable, delete, assign any role.
 * Owner: can create and edit users (farmer/owner roles only), reset passwords, disable accounts.
 *        Cannot delete users, reset admin passwords, or assign/modify admin accounts.
 * Farmer: no access to this page (hidden by RBAC guards in app.js).
 */
import { fbGetIdToken } from '../firebase-client.js';
import { showAppToast, showConfirmModal, wireAppDialog, escHtml } from '../ui/modal-ui.js';
import {
  validatePassword,
  passwordsMatch,
  syncPasswordChecklistUI,
  PASSWORD_RULES,
} from '../password-rules.js';

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

function normalizeUserRecord(id, data) {
  const row = { id, ...data };
  if (row.role === 'manager') row.role = 'owner';
  if (row.role === 'viewer') row.role = 'farmer';
  row.joinedDateMs = parseUserTimestampMs(
    row.joinedDateMs ?? row.joinedDate ?? row.createdAt ?? row.creationTime ?? row.metadata?.creationTime,
  );
  return row;
}

function parseUserTimestampMs(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value?.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    const ms = d?.getTime?.();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value?._seconds != null) {
    return Number(value._seconds) * 1000;
  }
  if (value?.seconds != null) {
    return Number(value.seconds) * 1000;
  }
  return null;
}

function formatJoinedDate(user) {
  const ms = parseUserTimestampMs(user?.joinedDateMs ?? user?.joinedDate ?? user?.createdAt);
  return ms ? new Date(ms).toLocaleDateString() : '—';
}

/** Snapshot of users loaded from User Management (for System Logs filters, etc.). */
export function getUsersList() {
  return allUsers.map((u) => ({
    id: u.id,
    displayName: (u.displayName || u.email || 'User').trim(),
    email: u.email || '',
    role: u.role || 'farmer',
    joinedDateMs: u.joinedDateMs ?? null,
    joinedDate: u.joinedDateMs ? new Date(u.joinedDateMs).toISOString() : null,
  }));
}

export async function loadUsers() {
  try {
    const token = await fbGetIdToken();
    const resp = await fetch('/api/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Failed to load users.');

    allUsers = (Array.isArray(data) ? data : [])
      .map((u) => normalizeUserRecord(u.id, u))
      .filter((u) => u.email && !deletedIds.has(u.id));
    updateStats();
    renderTable();
  } catch (e) {
    console.error('[UserMgmt] Failed to load users:', e);
    const tbody = document.getElementById('um-tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="um-empty">Could not load users.</td></tr>`;
    }
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
    const joined   = formatJoinedDate(u);
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

    const resetPwBtn = (isAdmin || ownerCanAct)
      ? `<button class="um-btn-icon" title="Reset password" data-action="reset-password" data-uid="${u.id}">
           <svg class="icon icon-14"><use href="#icon-key"/></svg>
         </button>`
      : '';

    const toggleBtn = ((isAdmin && !isSelf) || ownerCanAct)
      ? `<button class="um-btn-icon${disabled ? ' success' : ' warn'}" title="${disabled ? 'Enable account' : 'Disable account'}" data-action="toggle" data-uid="${u.id}" data-disabled="${disabled}">
           <svg class="icon icon-14"><use href="${disabled ? '#icon-check' : '#icon-warning'}"/></svg>
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
        <td><div class="um-actions">${editBtn}${resetPwBtn}${toggleBtn}${deleteBtn}</div></td>
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
      if (action === 'reset-password') openResetPasswordModal(user);
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
  dlg.className = 'um-modal app-modal';

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
            ${isEdit ? 'readonly class="um-readonly"' : ''} />
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
          <label>Farm ID <span class="um-field-label-hint">(optional)</span></label>
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
  const { close } = wireAppDialog(dlg, { initialFocusSelector: '#um-f-name' });
  dlg.querySelector('#um-dlg-close')?.addEventListener('click', close);
  dlg.querySelector('#um-dlg-cancel')?.addEventListener('click', close);

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
    if (!isEdit) {
      const createPw = dlg.querySelector('#um-f-password')?.value || '';
      const pwResult = validatePassword(createPw);
      if (!pwResult.ok) {
        showErr(errEl, 'Password does not meet requirements: ' + pwResult.errors.join(', '));
        return;
      }
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
        const token = await fbGetIdToken();
        const resp = await fetch(`/api/users/${user.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ displayName: name, phone, role, farmId }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Failed to update user.');
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
        allUsers.push({
          id: data.uid,
          email,
          displayName: name || email.split('@')[0],
          phone,
          role,
          status: 'active',
          farmId,
          joinedDateMs: Date.now(),
        });
      }
      updateStats();
      renderTable();
      showAppToast(isEdit ? 'User updated successfully.' : 'User created successfully.', 'success');
      close();
    } catch (e) {
      showErr(errEl, 'Save failed: ' + (e?.message || String(e)));
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Save Changes' : 'Create User';
    }
  });
}

// ─── Reset password modal ─────────────────────────────────────────────────────

function buildPasswordChecklistHtml(idPrefix) {
  return `
    <div class="acct-pw-requirements" aria-live="polite">
      <p class="acct-pw-requirements-label">Password requirements</p>
      <ul class="acct-pw-checklist">
        ${PASSWORD_RULES.map(({ id, message }) => `
          <li id="${idPrefix}${id}" class="acct-pw-check">
            <span class="acct-pw-check-mark" aria-hidden="true"></span>
            <span class="acct-pw-check-text">${message}</span>
          </li>`).join('')}
        <li id="${idPrefix}rule-match" class="acct-pw-check">
          <span class="acct-pw-check-mark" aria-hidden="true"></span>
          <span class="acct-pw-check-text">Passwords match</span>
        </li>
      </ul>
    </div>`;
}

function openResetPasswordModal(user) {
  const name = user.displayName || user.email?.split('@')[0] || 'User';
  const email = user.email || '—';
  const idPrefix = 'um-';

  const dlg = document.createElement('dialog');
  dlg.className = 'um-modal app-modal';

  dlg.innerHTML = `
    <div class="um-modal-inner">
      <div class="um-modal-head">
        <div>
          <div class="um-modal-title">Reset Password</div>
          <div class="um-modal-sub">Set a new password for <strong>${esc(name)}</strong> (${esc(email)}). This updates Firebase Authentication immediately.</div>
        </div>
        <button class="um-modal-close" id="um-pw-close" type="button" aria-label="Close">
          <svg class="icon icon-16"><use href="#icon-x"/></svg>
        </button>
      </div>

      <div class="um-form-grid">
        <div class="um-field full">
          <label>New password</label>
          <input id="um-pw-new" type="password" autocomplete="new-password" placeholder="Create a new password" />
        </div>
        <div class="um-field full">
          <label>Confirm new password</label>
          <input id="um-pw-confirm" type="password" autocomplete="new-password" placeholder="Re-enter new password" />
        </div>
        <div class="um-field full um-pw-checklist-wrap">
          ${buildPasswordChecklistHtml(idPrefix)}
        </div>
      </div>

      <div id="um-pw-error" class="um-error"></div>

      <div class="um-modal-footer">
        <button type="button" class="btn btn-outline" id="um-pw-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="um-pw-save">Reset Password</button>
      </div>
    </div>
  `;

  document.body.appendChild(dlg);
  dlg.showModal();
  const { close } = wireAppDialog(dlg, { initialFocusSelector: '#um-pw-new' });

  const syncRules = () => {
    syncPasswordChecklistUI({
      password: dlg.querySelector('#um-pw-new')?.value || '',
      confirm: dlg.querySelector('#um-pw-confirm')?.value || '',
      ruleIdPrefix: idPrefix,
      matchRuleId: `${idPrefix}rule-match`,
    });
  };

  dlg.querySelector('#um-pw-new')?.addEventListener('input', syncRules);
  dlg.querySelector('#um-pw-confirm')?.addEventListener('input', syncRules);
  dlg.querySelector('#um-pw-close')?.addEventListener('click', close);
  dlg.querySelector('#um-pw-cancel')?.addEventListener('click', close);
  syncRules();

  dlg.querySelector('#um-pw-save')?.addEventListener('click', async () => {
    const errEl = dlg.querySelector('#um-pw-error');
    const newPw = dlg.querySelector('#um-pw-new')?.value || '';
    const confirm = dlg.querySelector('#um-pw-confirm')?.value || '';
    const saveBtn = dlg.querySelector('#um-pw-save');

    if (errEl) {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }

    if (!newPw || !confirm) {
      showErr(errEl, 'New password and confirmation are required.');
      return;
    }
    const pwResult = validatePassword(newPw);
    if (!pwResult.ok) {
      showErr(errEl, 'Password does not meet requirements: ' + pwResult.errors.join(', '));
      return;
    }
    if (!passwordsMatch(newPw, confirm)) {
      showErr(errEl, 'Passwords do not match.');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Resetting…';

    try {
      const token = await fbGetIdToken();
      const resp = await fetch(`/api/users/${user.id}/password`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: newPw }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Failed to reset password.');

      showAppToast(`Password reset successfully for ${name}.`, 'success');
      close();
    } catch (e) {
      showErr(errEl, e?.message || 'Password reset failed.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Reset Password';
    }
  });
}

// ─── Disable / Enable confirmation ───────────────────────────────────────────

function confirmToggle(user) {
  const isDisabled = user.status !== 'active';
  const action     = isDisabled ? 'Enable' : 'Disable';
  const name       = user.displayName || user.email || 'this user';

  showConfirmModal({
    title: `${action} account`,
    subtitle: isDisabled
      ? 'The user will be able to sign in again immediately.'
      : 'The user will be signed out and blocked from logging in.',
    messageHtml: isDisabled
      ? `Re-enable <strong>${escHtml(name)}</strong>?`
      : `Disable <strong>${escHtml(name)}</strong>? They will lose access until re-enabled.`,
    confirmLabel: action,
    variant: isDisabled ? 'warning' : 'warning',
    destructive: !isDisabled,
    onConfirm: async () => {
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
      showAppToast(`Account ${isDisabled ? 'enabled' : 'disabled'} for ${name}.`, 'success');
    },
  });
}

// ─── Delete confirmation ──────────────────────────────────────────────────────

function confirmDelete(user) {
  const name = user.displayName || user.email || 'this user';

  showConfirmModal({
    title: 'Delete user',
    subtitle: 'This permanently removes the user account from the system.',
    messageHtml: `Delete <strong>${escHtml(name)}</strong>? This action cannot be undone.`,
    confirmLabel: 'Delete user',
    destructive: true,
    onConfirm: async () => {
      const token = await fbGetIdToken();
      const resp = await fetch(`/api/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Request failed.');
      deletedIds.add(user.id);
      allUsers = allUsers.filter((u) => u.id !== user.id);
      updateStats();
      renderTable();
      showAppToast(`User "${name}" deleted.`, 'success');
      loadUsers();
    },
  });
}

function showErr(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}
