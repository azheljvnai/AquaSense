# Hosting AquaSense (Vercel + free options)

This repo is a **Node/Express backend** (`backend/server.js`) that:

- Serves the SPA from `public/` (and also serves assets from `frontend/`)
- Provides backend APIs under `/api/*` (ex: `/api/config`, `/api/users`, `/api/ponds`, etc.)

Because of that, you have 3 realistic deployment shapes:

- **Full app (recommended)**: host the **Express server** on a free backend host (Render/Railway/Fly). This keeps `/api/*` working.
- **Split**: host **frontend on Vercel**, host **backend elsewhere**, then proxy `/api/*` to the backend.
- **Vercel-only (advanced)**: convert Express into a Vercel Serverless Function using a `vercel.json` + API entry.

---

## What you need (applies to all options)

### Environment variables used by this repo

The backend reads `.env` from the repo root locally. In hosting platforms, you set these as **Environment Variables**:

- **PORT**: optional (most hosts set this automatically)
- **DEVICE_ID**: optional (defaults to `device001`)
- **FIREBASE_DATABASE_URL**: required for pre-filling config and Admin SDK DB access
- **FIREBASE_SERVICE_ACCOUNT_PATH**: optional path to a JSON key file (recommended locally)

Optional (used by `/api/config` and some frontend features):

- **FIREBASE_API_KEY**
- **FIREBASE_AUTH_DOMAIN**
- **FIREBASE_PROJECT_ID**
- **FIREBASE_STORAGE_BUCKET**
- **FIREBASE_MESSAGING_SENDER_ID**
- **FIREBASE_APP_ID**
- **EMAILJS_PUBLIC_KEY**
- **EMAILJS_SERVICE_ID**
- **EMAILJS_TEMPLATE_ID**

### Firebase Admin SDK note (important)

Several `/api/*` endpoints require Firebase Admin SDK auth/Firestore access.

- On servers like **Render/Railway/Fly**, the easiest approach is to provide a **Service Account JSON**.
- On hosts that don’t support uploading files, prefer storing the service account **JSON as an env var** (see “Service account JSON via env var” below).

---

## Option A (recommended): Deploy the full app on Render (free)

This is the simplest “it just works” approach: your **backend serves the frontend**, and `/api/*` works on the same domain.

### Steps

1. Push your repo to GitHub.
2. Create a new **Web Service** on Render.
3. Connect your GitHub repo.
4. Set:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Add Environment Variables in Render:
   - `FIREBASE_DATABASE_URL` (required)
   - `DEVICE_ID` (optional)
   - Add Firebase web config fields (optional; see list above)
6. For Admin SDK:
   - EITHER set `GOOGLE_APPLICATION_CREDENTIALS` using Render’s “Secret Files” feature (if enabled for you)
   - OR use the “Service account JSON via env var” pattern below (recommended for hosts without secret files)
7. Deploy. Your app will be available at the Render URL.

### Service account JSON via env var (works on most hosts)

If your host cannot mount a JSON file, do this:

1. Create an env var named **`FIREBASE_SERVICE_ACCOUNT_JSON`** containing the full JSON contents.
2. Update the backend to read from that env var (small code change). If you want, tell me and I’ll add it safely (it should write a temporary file or initialize admin with `credential.cert(JSON.parse(...))` directly).

---

## Option B: Vercel (frontend) + Render/Railway (backend)

Use this if you specifically want Vercel for the UI, but keep your Express APIs running elsewhere.

### Step 1 — Deploy the backend (Render or Railway)

Follow Option A (Render) or the Railway steps below, and copy the backend URL, e.g.:

- `https://aquasense-backend.onrender.com`

### Step 2 — Deploy the frontend on Vercel (static)

1. Create a new Vercel project from your repo.
2. In Vercel “Project Settings → General” set:
   - **Root Directory**: `public`
   - **Build Command**: leave empty (or `echo "no build"`)
   - **Output Directory**: `.` (or leave default for static)
3. Add a `vercel.json` at the repo root to proxy API calls to your backend:

```json
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://YOUR_BACKEND_HOST/api/$1" }
  ]
}
```

4. Deploy.

### Notes for split hosting

- Your frontend code calls `/api/config` (same origin). The rewrite makes it hit the backend.
- Any authenticated calls to `/api/*` will also go to the backend through the rewrite.

---

## Option C (advanced): Deploy everything on Vercel (Serverless)

Vercel can run Node serverless functions, but your current backend is a long-running Express server (`app.listen(...)`).

To deploy on Vercel, you typically:

- Create an API entry like `api/index.js` (or `api/server.js`) that **exports** the Express app as a handler
- Add `vercel.json` routes so:
  - `/api/*` is handled by that serverless function
  - `/` and static files come from `public/`

If you want this approach, say so and I’ll implement the needed files and changes (it’s a bit more finicky than Render/Railway).

---

## Other free/cheap hosting options

### Railway (easy for Node)

1. Create a Railway project from GitHub.
2. Set “Root Directory” to `backend` (or configure service path).
3. Add env vars (same as Option A).
4. Deploy. Railway will provide a URL.

### Fly.io (great free-ish, more setup)

1. Install Fly CLI.
2. Create an app and deploy the `backend/` service as a Node app.
3. Set secrets for env vars.

---

## Quick “static only” deployment (no backend)

If you only deploy `public/` as a static site (Vercel/Netlify/GitHub Pages):

- The app UI will load, but `/api/config` won’t exist.
- You must manually paste the Firebase Realtime Database URL in the UI before clicking **Connect**.
- Any features that rely on backend endpoints (like `/api/users`, ponds/configurations APIs) will not work.

---

## Troubleshooting

- **Blank page / assets not found**: make sure the host is serving the correct folder (`public/`) and that paths are correct.
- **`/api/config` 404**: you deployed static-only, or your Vercel rewrite is missing/wrong.
- **Admin SDK “not initialised”**: you need to provide credentials (service account or application default credentials).
- **CORS issues**: use same-origin (Option A) or Vercel rewrites (Option B) to avoid browser CORS problems.

