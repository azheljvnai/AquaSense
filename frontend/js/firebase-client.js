/**
 * Firebase client bootstrap (Web SDK) for Auth, Firestore, and RTDB.
 * Uses ESM imports directly from gstatic (no bundler).
 */
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, getIdToken, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore,
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
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getDatabase, ref, onValue, set, query as rtdbQuery, orderByChild, startAt, endAt, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

let app = null;
let auth = null;
let fs = null;
let rtdb = null;

export function initFirebase(firebaseConfig) {
  const cfg = firebaseConfig || {};
  const hasAny = !!(cfg.apiKey || cfg.authDomain || cfg.projectId || cfg.appId || cfg.databaseURL);
  if (!hasAny) throw new Error('Missing Firebase config. Set FIREBASE_* env vars on backend.');

  if (!app) {
    const apps = getApps();
    app = apps.length ? apps[0] : initializeApp(cfg);
    auth = getAuth(app);
    fs = getFirestore(app);
    rtdb = getDatabase(app);
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
  return getIdToken(user, /* forceRefresh */ false);
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
export const fbOnSnapshot = onSnapshot;
export const fbServerTimestamp = serverTimestamp;

// RTDB helpers
export function fbDatabase() {
  return getFirebase().rtdb;
}
export const fbRef = ref;
export const fbOnValue = onValue;
export const fbSet = set;
export const fbRtdbQuery = rtdbQuery;
export const fbOrderByChild = orderByChild;
export const fbStartAt = startAt;
export const fbEndAt = endAt;
export const fbGet = get;

