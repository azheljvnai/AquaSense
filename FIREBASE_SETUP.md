# Firebase Setup Guide — CrayFarm / AquaSense

Complete checklist of everything you need to configure in Firebase for this app to work.

---

## 1. Create a Firebase Project

1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. `aquasense`)
3. Disable Google Analytics if you don't need it → **Create project**

---

## 2. Register a Web App

1. In your project, click the **`</>`** (Web) icon to add an app
2. Give it a nickname (e.g. `CrayFarm Web`)
3. **Do NOT** enable Firebase Hosting (you're using your own Express server)
4. Copy the config object — you'll need these values for your `.env` file:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "your-project-id.firebaseapp.com",
  databaseURL: "https://your-project-id.region.firebasedatabase.app",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

Paste these into your `.env`:

```env
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...
FIREBASE_DATABASE_URL=https://your-project-id.region.firebasedatabase.app
```

---

## 3. Enable Email/Password Authentication ← REQUIRED FOR LOGIN

> This is the most common reason sign-in does nothing.

1. Sidebar → **Authentication** → **Sign-in method** tab
2. Click **Email/Password**
3. Toggle **Enable** → **Save**

Without this, `signInWithEmailAndPassword` silently fails or returns `auth/operation-not-allowed`.

---

## 4. Add Your User Account

1. Sidebar → **Authentication** → **Users** tab
2. Click **Add user**
3. Enter email and password
4. Click **Add user**

> The app is invite-only — users cannot self-register. All accounts must be created here by an admin.

---

## 5. Firestore Database — Create & Configure

The app stores user profiles and settings in Firestore.

### 5a. Create the database

1. Sidebar → **Firestore Database** → **Create database**
2. Choose **Start in production mode** (you'll set rules next)
3. Pick a region close to you (e.g. `asia-southeast1` for Philippines)

### 5b. Security Rules

Go to **Firestore Database** → **Rules** tab and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can read/write their own profile
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      // Admins can read all user profiles
      allow read: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // Farm profile — any authenticated user can read, only admin/manager can write
    match /farm/{docId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'manager'];
    }

    // Deny everything else
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Click **Publish**.

### 5c. Collections (auto-created on first use)

The app creates these automatically — you don't need to create them manually:

| Collection | Purpose | Created when |
|---|---|---|
| `users` | User profiles (role, name, phone, farmId) | First login |
| `farm` | Farm information (name, location, size) | Farm profile is saved |

### 5d. Manually set a user's role to `admin`

After your first login, your profile is created with `role: "viewer"` by default. To make yourself admin:

1. Firestore → **users** collection
2. Find your document (the document ID is your Firebase Auth UID)
3. Click the `role` field → change value to `admin` → **Update**

Roles available: `admin`, `manager`, `viewer`

---

## 6. Realtime Database — Create & Configure

Used for live sensor data from the ESP32/IoT device.

### 6a. Create the database

1. Sidebar → **Realtime Database** → **Create database**
2. Choose the same region as Firestore
3. Start in **locked mode**

### 6b. Security Rules

Go to **Realtime Database** → **Rules** tab and paste:

```json
{
  "rules": {
    "devices": {
      "$deviceId": {
        "sensors": {
          ".read": "auth != null",
          ".write": "auth != null"
        },
        "feeding": {
          ".read": "auth != null",
          ".write": "auth != null"
        }
      }
    }
  }
}
```

Click **Publish**.

### 6c. Data structure (written by your ESP32 device)

```
/devices/
  device001/
    sensors/
      ph: 7.2
      do: 8.5
      turb: 12.3
      temp: 24.1
    feeding/
      manualFeed: false
      schedule1: "08:00"
      schedule2: "18:00"
```

The `DEVICE_ID` in your `.env` must match the key under `/devices/` (default: `device001`).

---

## 7. Authorized Domains (for Auth to work on your server)

1. Sidebar → **Authentication** → **Settings** tab → **Authorized domains**
2. `localhost` is already there by default
3. If you deploy to a real domain, add it here (e.g. `yourdomain.com`)

> If you're getting `auth/unauthorized-domain` errors, this is why.

---

## 8. Quick Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Sign-in button does nothing | Firebase not initialized yet | Make sure backend is running (`npm start`) |
| `auth/operation-not-allowed` | Email/Password not enabled | Step 3 above |
| `auth/unauthorized-domain` | Domain not whitelisted | Step 7 above |
| `auth/invalid-credential` | Wrong email or password | Double-check credentials in Auth → Users |
| `auth/network-request-failed` | Can't reach Firebase | Check internet / firewall |
| Profile loads but role is `viewer` | Default role on new accounts | Step 5d — manually set role in Firestore |
| Sensor data not showing | RTDB URL wrong or rules blocking | Check `FIREBASE_DATABASE_URL` in `.env` and RTDB rules |
| Feeding/Config pages disabled | Role is `viewer` | Change role to `admin` or `manager` in Firestore |

---

## 9. Verify Your `.env` is Complete

```env
PORT=3000
DEVICE_ID=device001

FIREBASE_DATABASE_URL=https://your-project-id.region.firebasedatabase.app
FIREBASE_API_KEY=AIza...
FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
FIREBASE_MESSAGING_SENDER_ID=1234567890
FIREBASE_APP_ID=1:1234567890:web:abc123
```

All 8 values must be filled. Then restart the backend: `npm start`
