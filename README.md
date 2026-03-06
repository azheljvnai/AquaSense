# AquaSense / CrayFarm

Aquaculture monitoring dashboard (CrayFarm) with real-time water quality metrics, feeding control, and reporting. The app uses **Firebase Realtime Database** for sensors and feeding; the backend serves the frontend and provides config from environment variables.

---

## How It Works

### Architecture

- **Backend** (Node.js + Express): Serves the frontend static files and exposes **one API**: `GET /api/config`, which returns `FIREBASE_DATABASE_URL` and `DEVICE_ID` from `.env`. Private keys never live in the frontend bundle.
- **Frontend** (HTML + CSS + JS modules): Single-page app with sidebar navigation (Dashboard, Water Quality, Historical Data, Feeding, Alerts, Farm & Profile, Reports, Configuration). On load it:
  1. Fetches `/api/config` (if running behind the backend) and pre-fills the Firebase URL input.
  2. When you click **Connect**, it initializes the Firebase client with that URL and subscribes to the same paths as the original app.
- **Firebase** (unchanged): The frontend still talks directly to Firebase Realtime Database using the same paths and logic as the original `dashboard.html`:
  - ` /devices/<deviceId>/sensors` — ph, do, turb, temp
  - ` /devices/<deviceId>/feeding` — schedule1, schedule2, manualFeed

No existing API endpoints or Firebase logic were changed; only the URL (and optional device id) are supplied via the backend or manual input.

### Project Structure

```
AquaSense/
├── .env                 # Private config (create from .env.example; do not commit)
├── .env.example         # Template for .env
├── .gitignore
├── README.md            # This file
├── backend/
│   ├── package.json
│   └── server.js        # Express: static frontend + GET /api/config
├── frontend/
│   ├── index.html       # Single-page app (all views)
│   ├── css/
│   │   ├── shared.css   # Layout, sidebar, cards, buttons, tabs, icons, WQ status
│   │   ├── dashboard.css
│   │   ├── water-quality.css
│   │   ├── historical-data.css
│   │   ├── feeding.css
│   │   ├── alerts.css
│   │   ├── farm-profile.css
│   │   ├── reports.css
│   │   └── configuration.css
│   ├── js/
│   │   ├── app.js       # Entry: nav, clock, config, Firebase wiring, feature inits
│   │   ├── config.js    # Fetches /api/config
│   │   ├── firebase.js  # Firebase connect, triggerFeed, saveSchedules (same API usage)
│   │   ├── charts.js    # Chart helpers (dashboard, historical, feeding)
│   │   ├── utils.js     # log, getBadge, thresholds, sparklines
│   │   └── features/
│   │       ├── dashboard.js
│   │       ├── water-quality.js
│   │       ├── historical-data.js
│   │       ├── feeding.js
│   │       ├── alerts.js
│   │       ├── farm-profile.js
│   │       ├── reports.js
│   │       └── configuration.js
│   └── icons.svg        # SVG symbol definitions (optional reference)
└── dashboard.html       # Legacy single-file app (uses frontend/css/shared.css)
```

### Water Quality Indicators

Three status levels with clear styling (in `shared.css` and inline badges):

- **Normal** — green badge/background (`status-normal`, `.scard-badge.ok`)
- **Warning** — yellow/amber (`status-warning`, `.scard-badge.warn`)
- **Critical** — red (`status-critical`, `.scard-badge.danger`)

Thresholds are defined in `frontend/js/utils.js` (`thresh`) and used by `getBadge()` and the dashboard cards.

---

## How to Run

### 1. Environment

Copy the example env file and set your Firebase URL (and optional port/device):

```bash
cp .env.example .env
```

Edit `.env`:

- **FIREBASE_DATABASE_URL** — Your Firebase Realtime Database URL (e.g. `https://your-project.asia-southeast1.firebasedatabase.app/`).
- **DEVICE_ID** — Optional; defaults to `device001` (path: `/devices/device001/...`).
- **PORT** — Optional; default `3000`.

### 2. Backend

From the project root (recommended):

```bash
npm start
```

If this is your first run, install backend dependencies first:

```bash
npm run install:backend
npm start
```

Or run directly inside the backend folder:

```bash
cd backend
npm install
npm start
```

You should see something like:

- `AquaSense backend running at http://localhost:3000`
- Frontend is served from the `frontend/` folder.

### 3. Open the App

In the browser go to:

- **http://localhost:3000**

The app will load `frontend/index.html`. If `FIREBASE_DATABASE_URL` is set in `.env`, the Firebase URL field will be pre-filled. Click **Connect** to attach to your Firebase project. Dashboard metrics, charts, feeding panel, and activity log will work as in the original design.

---

## How to Test

### With backend (recommended)

1. **Run backend**: `cd backend && npm install && npm start`.
2. **Open**: http://localhost:3000.
3. **Config**: If the URL is pre-filled from `.env`, click **Connect**. Otherwise paste your Firebase Realtime Database URL and click **Connect**.
4. **Dashboard**: You should see:
   - Status (e.g. OFFLINE → CONNECTING → ONLINE) and clock in the top-right.
   - Sensor cards (pH, DO, Turbidity, Temperature) and Population placeholder updating when Firebase has data.
   - “Water Quality Trends (24h)” chart updating with sensor history.
   - Recent Alerts and Activity Log.
   - Feeding Control: schedules and **Manual Feed** / **Save Schedules** (same behavior as original).
5. **Navigation**: Use the sidebar to open Water Quality, Historical Data, Feeding, Alerts, Farm & Profile, Reports, Configuration. No “ML & Analytics”; Reports has Daily/Weekly/Monthly Water Quality Report and Feeding Report tabs.
6. **Firebase**: Ensure your Realtime Database has the expected structure under `/devices/device001/` (or your `DEVICE_ID`): e.g. `sensors` (ph, do, turb, temp) and `feeding` (schedule1, schedule2, manualFeed). The app does not create these; it only reads/writes the same paths as before.

### Notes about `dashboard.html` (legacy)

`dashboard.html` is a legacy single-file version kept for reference. When running the backend, visiting `dashboard.html` will redirect to the SPA entry (`/`) to prevent outdated UI from showing.

If you want a standalone run without the backend, serve `frontend/` using any static server (e.g. `npx serve frontend`). `GET /api/config` will fail (e.g. 404), so the Firebase URL will not be pre-filled; paste it manually and connect.

**Note:** Do not open `frontend/index.html` as a file (`file://`) in the browser. ES modules and `fetch('/api/config')` require a real origin; use the backend or a static server.

### Quick checks

- **Config**: With backend running, open http://localhost:3000/api/config. You should get JSON with `firebaseDatabaseUrl` and `deviceId` (no secrets beyond the Firebase URL).
- **Connect**: After Connect, the config bar can be hidden and status should show ONLINE if Firebase is reachable and data exists.
- **Feed**: Click **Manual Feed**; the app sets `manualFeed` to `true` and waits for the device to set it back to `false` (or a 10s timeout). Same as original.
- **Icons**: All UI uses SVG icons (from the inline sprite in `index.html`); no emojis in the main app.

---

## Summary

| Item | Description |
|------|-------------|
| **Run** | `cd backend && npm install && npm start` then open http://localhost:3000 |
| **Config** | Copy `.env.example` to `.env` and set `FIREBASE_DATABASE_URL` (and optionally `DEVICE_ID`, `PORT`) |
| **APIs** | Unchanged: Firebase paths `/devices/<id>/sensors` and `/devices/<id>/feeding`; backend only adds `GET /api/config` from env |
| **Test** | Open app → Connect (with or without pre-filled URL) → check Dashboard, nav, feeding, and Firebase data flow |
