/**
 * Profile feature: load the signed-in user from Firestore for the Account & security page.
 * Pond and team lists were removed from the profile UI; farm data is managed elsewhere.
 */
import { fbFirestore, fbDoc, fbGetDoc } from '../firebase-client.js';

const ROLE_LABEL = {
  admin: 'Admin',
  owner: 'Owner',
  farmer: 'Farmer',
  manager: 'Owner',
  viewer: 'Farmer',
};

const ROLE_DESC = {
  admin: 'You can manage users, ponds, configurations, reports, and other administrative settings across the farm.',
  owner: 'You can run day-to-day operations: ponds, feeding schedules, reports, configurations, and alerts for your team.',
  farmer: 'You can monitor sensors, trigger manual feeds, view feeding logs, and work with alerts for assigned ponds.',
  manager: 'You can run day-to-day operations: ponds, feeding schedules, reports, configurations, and alerts for your team.',
  viewer: 'You can monitor sensors, trigger manual feeds, view feeding logs, and work with alerts for assigned ponds.',
};

function avatarLetter(nameOrEmail) {
  const s = String(nameOrEmail || '').trim();
  return (s[0] || 'U').toUpperCase();
}

function formatUid(uid) {
  if (!uid) return '—';
  if (uid.length <= 14) return uid;
  return `${uid.slice(0, 6)}…${uid.slice(-4)}`;
}

function fmtDate(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtDateTime(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

let lastAuthUser = null;
let copyBound = false;

export function init() {
  const els = {
    userPhone: document.getElementById('user-phone'),
    userEmail: document.getElementById('user-email'),
    fpAvatarLetter: document.getElementById('fp-avatar-letter'),
    fpDisplayName: document.getElementById('fp-display-name'),
    fpRoleBadge: document.getElementById('fp-role-badge'),
    fpMemberSince: document.getElementById('fp-member-since'),
    fpEmailVerified: document.getElementById('fp-email-verified'),
    fpLastSignin: document.getElementById('fp-last-signin'),
    fpUserId: document.getElementById('fp-user-id'),
    fpFarmId: document.getElementById('fp-farm-id'),
    fpRoleDesc: document.getElementById('fp-role-desc'),
  };

  if (!els.userEmail) return;

  if (!copyBound) {
    copyBound = true;
    document.getElementById('btn-copy-user-id')?.addEventListener('click', async () => {
      const uid = lastAuthUser?.uid;
      if (!uid) return;
      try {
        await navigator.clipboard.writeText(uid);
        if (typeof window.showToast === 'function') window.showToast('User ID copied', 'success');
      } catch {
        if (typeof window.showToast === 'function') window.showToast('Could not copy ID', 'error');
      }
    });
  }

  async function loadForUser(user) {
    lastAuthUser = user || null;
    const fs = fbFirestore();
    const userSnap = await fbGetDoc(fbDoc(fs, 'users', user.uid));
    const profile = userSnap.exists() ? userSnap.data() : {};

    const displayName = profile.displayName || (profile.email ? profile.email.split('@')[0] : 'User');
    const role = String(profile.role || 'farmer').toLowerCase();
    const normRole = role === 'manager' ? 'owner' : role === 'viewer' ? 'farmer' : role;

    if (els.userEmail) els.userEmail.textContent = profile.email || user.email || '—';
    if (els.userPhone) els.userPhone.textContent = profile.phone || '—';

    if (els.fpAvatarLetter) els.fpAvatarLetter.textContent = avatarLetter(displayName);
    if (els.fpDisplayName) els.fpDisplayName.textContent = displayName;
    if (els.fpRoleBadge) {
      els.fpRoleBadge.textContent = ROLE_LABEL[role] || ROLE_LABEL[normRole] || role;
      els.fpRoleBadge.className = `um-role-badge um-role-${normRole}`;
    }
    if (els.fpMemberSince) {
      try {
        const d = profile.createdAt?.toDate ? profile.createdAt.toDate() : null;
        els.fpMemberSince.textContent = fmtDate(d);
      } catch {
        els.fpMemberSince.textContent = '—';
      }
    }

    if (els.fpEmailVerified) {
      els.fpEmailVerified.textContent = '';
      const ok = user.emailVerified === true;
      const span = document.createElement('span');
      span.className = ok ? 'badge-pill status-normal' : 'badge-pill status-warning';
      span.textContent = ok ? 'Verified' : 'Not verified';
      els.fpEmailVerified.appendChild(span);
    }

    let lastDt = null;
    try {
      if (profile.lastLoginAt?.toDate) lastDt = profile.lastLoginAt.toDate();
      else if (user.metadata?.lastSignInTime) lastDt = new Date(user.metadata.lastSignInTime);
    } catch {
      lastDt = null;
    }
    if (els.fpLastSignin) els.fpLastSignin.textContent = fmtDateTime(lastDt);

    const uid = user.uid || '';
    if (els.fpUserId) {
      els.fpUserId.textContent = formatUid(uid);
      els.fpUserId.title = uid || '';
    }

    const farmId = String(profile.farmId || '').trim();
    if (els.fpFarmId) {
      els.fpFarmId.textContent = farmId || '—';
      els.fpFarmId.title = farmId || '';
    }

    if (els.fpRoleDesc) {
      els.fpRoleDesc.textContent = ROLE_DESC[normRole] || ROLE_DESC.farmer;
    }

    return { profile, farmId };
  }

  window._farmProfileOnUser = async (user) => {
    if (!user) return;
    try {
      await loadForUser(user);
    } catch {
      // ignore
    }
  };
}
