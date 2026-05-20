/**
 * Profile feature: load the signed-in user from Firestore for the Account & security page.
 */
import { fbFirestore, fbDoc, fbGetDoc } from '../firebase-client.js';

const ROLE_LABEL = {
  admin: 'Admin',
  owner: 'Owner',
  farmer: 'Farmer',
  manager: 'Owner',
  viewer: 'Farmer',
};

function avatarLetter(nameOrEmail) {
  const s = String(nameOrEmail || '').trim();
  return (s[0] || 'U').toUpperCase();
}

function fmtDate(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function fmtDateTime(d) {
  if (!d || !(d instanceof Date) || Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

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
  };

  if (!els.userEmail) return;

  async function loadForUser(user) {
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

    return { profile, farmId: String(profile.farmId || '').trim() };
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
