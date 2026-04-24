/**
 * Farm & Profile feature: load farm + members from Firestore and allow profile edits.
 * All roles (admin, owner, farmer) can view this page and edit their own profile.
 */
import {
  fbFirestore,
  fbDoc,
  fbGetDoc,
  fbCollection,
  fbGetDocs,
  fbServerTimestamp,
  fbGetIdToken,
} from '../firebase-client.js';

export function init() {
  const els = {
    farmName: document.getElementById('farm-name'),
    farmName2: document.getElementById('farm-name-2'),
    farmLocation: document.getElementById('farm-location'),
    farmLocation2: document.getElementById('farm-location-2'),
    farmCreated: document.getElementById('farm-created'),
    farmEstablished: document.getElementById('farm-established'),
    farmSize: document.getElementById('farm-size'),
    farmCapacity: document.getElementById('farm-capacity'),
    farmManager: document.getElementById('farm-manager'),
    userPhone: document.getElementById('user-phone'),
    userEmail: document.getElementById('user-email'),
    staffList: document.getElementById('staff-list'),
    btnEdit: document.getElementById('btn-edit-profile'),
    fpAvatarLetter: document.getElementById('fp-avatar-letter'),
    fpDisplayName: document.getElementById('fp-display-name'),
    fpRoleBadge: document.getElementById('fp-role-badge'),
    fpMemberSince: document.getElementById('fp-member-since'),
  };

  if (!els.farmName || !els.staffList) return;

  const fmtYear = (ts) => {
    try {
      const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
      if (!d) return '—';
      return `Est. ${d.getFullYear()}`;
    } catch {
      return '—';
    }
  };

  const avatarLetter = (nameOrEmail) => {
    const s = String(nameOrEmail || '').trim();
    return (s[0] || 'U').toUpperCase();
  };

  const ROLE_LABEL = { admin: 'Admin', owner: 'Owner', farmer: 'Farmer',
    // legacy aliases
    manager: 'Owner', viewer: 'Farmer' };

  function renderStaff(members) {
    els.staffList.innerHTML = '';
    if (!Array.isArray(members) || !members.length) {
      els.staffList.innerHTML = `<div style="color:var(--text-muted);font-size:0.9rem;padding:12px 0;">No staff members found.</div>`;
      return;
    }
    for (const m of members) {
      const name = m.displayName || m.email || 'Member';
      const email = m.email || '';
      const role = (m.role || 'viewer').toString();
      const since = m.joinedAt?.toDate ? m.joinedAt.toDate().getFullYear() : '';
      const el = document.createElement('div');
      el.className = 'staff-item';
      el.innerHTML = `
        <div class="avatar">${avatarLetter(name)}</div>
        <div class="staff-info">
          <div class="staff-name">${name}</div>
          <div class="staff-email">${email}</div>
        </div>
        <span class="um-role-badge um-role-${role}" style="font-size:0.7rem;">${ROLE_LABEL[role] || role}</span>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-left:auto;">${since ? `Since ${since}` : ''}</div>
      `;
      els.staffList.appendChild(el);
    }
  }

  async function loadForUser(user) {
    const fs = fbFirestore();
    const userSnap = await fbGetDoc(fbDoc(fs, 'users', user.uid));
    const profile = userSnap.exists() ? userSnap.data() : {};

    const displayName = profile.displayName || (profile.email ? profile.email.split('@')[0] : 'User');
    const role = profile.role || 'farmer';

    if (els.userEmail) els.userEmail.textContent = profile.email || user.email || '—';
    if (els.userPhone) els.userPhone.textContent = profile.phone || '—';
    if (els.farmManager) els.farmManager.textContent = displayName;

    // New profile fields
    if (els.fpAvatarLetter) els.fpAvatarLetter.textContent = avatarLetter(displayName);
    if (els.fpDisplayName) els.fpDisplayName.textContent = displayName;
    if (els.fpRoleBadge) {
      els.fpRoleBadge.textContent = ROLE_LABEL[role] || role;
      els.fpRoleBadge.className = `um-role-badge um-role-${role}`;
    }
    if (els.fpMemberSince) {
      try {
        const d = profile.createdAt?.toDate ? profile.createdAt.toDate() : null;
        els.fpMemberSince.textContent = d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
      } catch { els.fpMemberSince.textContent = '—'; }
    }

    const farmId = profile.farmId || '';
    if (!farmId) {
      els.farmName.textContent = 'No farm assigned';
      if (els.farmName2) els.farmName2.textContent = '—';
      if (els.farmLocation) els.farmLocation.textContent = '—';
      if (els.farmLocation2) els.farmLocation2.textContent = '—';
      if (els.farmCreated) els.farmCreated.textContent = '—';
      if (els.farmEstablished) els.farmEstablished.textContent = '—';
      if (els.farmSize) els.farmSize.textContent = '—';
      if (els.farmCapacity) els.farmCapacity.textContent = '—';
      renderStaff([]);
      return { profile, farmId: '' };
    }

    const farmSnap = await fbGetDoc(fbDoc(fs, 'farms', farmId));
    const farm = farmSnap.exists() ? farmSnap.data() : {};

    const farmName = farm.name || 'Farm';
    const location = farm.location || '—';
    els.farmName.textContent = farmName;
    if (els.farmName2) els.farmName2.textContent = farmName;
    if (els.farmLocation) els.farmLocation.textContent = location;
    if (els.farmLocation2) els.farmLocation2.textContent = location;
    if (els.farmCreated) els.farmCreated.textContent = fmtYear(farm.createdAt);
    if (els.farmEstablished) els.farmEstablished.textContent = fmtYear(farm.createdAt);
    if (els.farmSize) els.farmSize.textContent = farm.size || '—';
    if (els.farmCapacity) els.farmCapacity.textContent = farm.capacity || '—';

    const memCol = fbCollection(fs, 'farms', farmId, 'members');
    const memSnap = await fbGetDocs(memCol);
    const members = memSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderStaff(members);
    return { profile, farmId };
  }

  function openEditDialog(profile) {
    const esc = (s) =>
      String(s || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    const dlg = document.createElement('dialog');
    dlg.className = 'um-modal';
    dlg.innerHTML = `
      <div class="um-modal-inner">
        <div class="um-modal-head">
          <div>
            <div class="um-modal-title">Edit Profile</div>
            <div class="um-modal-sub">Update your display name and phone number.</div>
          </div>
          <button class="um-modal-close" value="cancel" aria-label="Close" id="ep-x">
            <svg class="icon icon-16"><use href="#icon-x"/></svg>
          </button>
        </div>
        <div class="um-form-grid">
          <div class="um-field">
            <label>Display Name</label>
            <input id="ep-name" type="text" value="${esc(profile.displayName)}" placeholder="Your name" />
          </div>
          <div class="um-field">
            <label>Phone Number</label>
            <input id="ep-phone" type="text" value="${esc(profile.phone)}" placeholder="+1 555 000 0000" />
          </div>
        </div>
        <div id="ep-error" style="color:var(--red-dark);font-size:0.8rem;margin-bottom:8px;display:none;"></div>
        <div class="um-modal-footer">
          <button type="button" class="btn btn-outline" id="ep-cancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="ep-save">Save Changes</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.showModal();

    const close = () => { dlg.close(); setTimeout(() => dlg.remove(), 0); };
    dlg.querySelector('#ep-x')?.addEventListener('click', close);
    dlg.querySelector('#ep-cancel')?.addEventListener('click', close);
    dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
    return dlg;
  }

  let lastProfile = {};
  let lastUser = null;

  // Called by app.js after Firebase is initialized and user signs in
  window._farmProfileOnUser = async (user) => {
    lastUser = user || null;
    if (!user) return;
    try {
      const { profile } = await loadForUser(user);
      lastProfile = profile || {};
    } catch {
      // ignore
    }
  };

  els.btnEdit?.addEventListener('click', async () => {
    if (!lastUser) return;
    const dlg = openEditDialog(lastProfile || {});
    dlg.querySelector('#ep-save')?.addEventListener('click', async () => {
      const errEl = dlg.querySelector('#ep-error');
      const name = (dlg.querySelector('#ep-name')?.value || '').trim();
      const phone = (dlg.querySelector('#ep-phone')?.value || '').trim();
      const saveBtn = dlg.querySelector('#ep-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const token = await fbGetIdToken();
        const resp = await fetch('/api/users/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ displayName: name || lastProfile?.displayName || '', phone }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || 'Save failed.');
        dlg.close();
        const { profile } = await loadForUser(lastUser);
        lastProfile = profile || {};
      } catch (e) {
        if (errEl) { errEl.textContent = 'Save failed: ' + (e?.message || String(e)); errEl.style.display = 'block'; }
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });
  });
}
