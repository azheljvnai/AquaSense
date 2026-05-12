/**
 * Firebase client bootstrap (Web SDK) for Auth, Firestore, and RTDB.
 * Uses ESM imports directly from gstatic (no bundler).
 */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, getIdToken, updatePassword, reauthenticateWithCredential, EmailAuthProvider, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getDatabase, ref, onValue, set, query as rtdbQuery, orderByChild, orderByKey, startAt, endAt, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

let app = null;
let auth = null;
let fs = null;
let rtdb = null;
let _emulatorsConnected = false;

function truthyEmulatorFlag(v) {
  return v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
}

export function initFirebase(firebaseConfig) {
  const cfg = firebaseConfig || {};
  const hasAny = !!(cfg.apiKey || cfg.authDomain || cfg.projectId || cfg.appId || cfg.databaseURL);
  if (!hasAny) throw new Error('Missing Firebase config. Set FIREBASE_* env vars on backend.');

  const {
    useFirebaseEmulators,
    firebaseEmulatorHost,
    firestoreEmulatorPort,
    authEmulatorPort,
    ...appOptions
  } = cfg;

  if (!app) {
    const apps = getApps();
    app = apps.length ? apps[0] : initializeApp(appOptions);
    auth = getAuth(app);
    fs = getFirestore(app);
    rtdb = getDatabase(app);

    if (!_emulatorsConnected && truthyEmulatorFlag(useFirebaseEmulators)) {
      _emulatorsConnected = true;
      const host = typeof firebaseEmulatorHost === 'string' && firebaseEmulatorHost.trim()
        ? firebaseEmulatorHost.trim()
        : '127.0.0.1';
      const fsPort = Number(firestoreEmulatorPort) > 0 ? Number(firestoreEmulatorPort) : 8080;
      const authPort = Number(authEmulatorPort) > 0 ? Number(authEmulatorPort) : 9099;
      try {
        connectFirestoreEmulator(fs, host, fsPort);
      } catch (e) {
        const msg = String(e?.message || e);
        if (!/already|have been initialized/i.test(msg)) throw e;
      }
      try {
        connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
      } catch (e) {
        const msg = String(e?.message || e);
        if (!/already|have been initialized/i.test(msg)) throw e;
      }
    }
  }
  return { app, auth, fs, rtdb };
}

export function getFirebase() {
  if (!app || !auth || !fs || !rtdb) throw new Error('Firebase not initialized. Call initFirebase() first.');
  return { app, auth, fs, rtdb };
}

// Auth helpers
export function fbAuth() {
  return getFirebase().auth;
}
export function fbOnAuthStateChanged(cb) {
  return onAuthStateChanged(fbAuth(), cb);
}
export function fbSignIn(email, password) {
  return signInWithEmailAndPassword(fbAuth(), email, password);
}
export function fbSignOut() {
  return signOut(fbAuth());
}

export async function fbReauthenticate(currentPassword) {
  const user = fbAuth().currentUser;
  if (!user || !user.email) throw new Error('No authenticated user.');
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  return reauthenticateWithCredential(user, cred);
}

export async function fbUpdatePassword(newPassword) {
  const user = fbAuth().currentUser;
  if (!user) throw new Error('No authenticated user.');
  return updatePassword(user, newPassword);
}

/**
 * Returns a fresh Firebase ID token for the currently signed-in user.
 * Pass this as `Authorization: Bearer <token>` on protected API calls.
 */
export async function fbGetIdToken() {
  const user = fbAuth().currentUser;
  if (!user) throw new Error('No authenticated user.');
  // Always force refresh so backend calls don't fail
  // with "Invalid or expired token" after the page is open a while.
  return getIdToken(user, /* forceRefresh */ true);
}

// Firestore helpers
export function fbFirestore() {
  return getFirebase().fs;
}
export const fbDoc = doc;
export const fbGetDoc = getDoc;
export const fbSetDoc = setDoc;
export const fbUpdateDoc = updateDoc;
export const fbDeleteDoc = deleteDoc;
export const fbAddDoc = addDoc;
export const fbCollection = collection;
export const fbGetDocs = getDocs;
export const fbQuery = query;
export const fbWhere = where;
export const fbOrderBy = orderBy;
export const fbLimit = limit;
export const fbOnSnapshot = onSnapshot;
export const fbServerTimestamp = serverTimestamp;
export const fbWriteBatch = writeBatch;

// RTDB helpers
export function fbDatabase() {
  return getFirebase().rtdb;
}
export const fbRef = ref;
export const fbOnValue = onValue;
export const fbSet = set;
export const fbRtdbQuery = rtdbQuery;
export const fbOrderByChild = orderByChild;
export const fbOrderByKey = orderByKey;
export const fbStartAt = startAt;
export const fbEndAt = endAt;
export const fbGet = get;

