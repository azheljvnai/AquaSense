# ESP32 History Data Setup

Two options for ensuring sensor history is recorded even when the browser is closed.

---

## Option A — ESP32 writes timestamps + history directly (Recommended)

This is the simplest and most reliable approach. The ESP32 writes to both `/sensors` (for live display) and `/history/{ts}` (for permanent storage) on every reading cycle.

### Arduino sketch changes

```cpp
#include <Firebase_ESP_Client.h>
#include <time.h>

// Add NTP sync in setup()
void setup() {
  // ... your existing WiFi connect code ...

  // Sync time via NTP
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Waiting for NTP time sync");
  while (time(nullptr) < 1000000000UL) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" done");
}

void sendSensorData(float ph, float doVal, float turb, float temp) {
  // Get current Unix timestamp in milliseconds
  unsigned long long tsMs = (unsigned long long)time(nullptr) * 1000ULL;

  String devicePath = "/devices/device001"; // match your DEVICE_ID in .env

  // 1. Write live sensor node (existing — keep this)
  FirebaseJson sensorJson;
  sensorJson.set("ph", ph);
  sensorJson.set("do", doVal);
  sensorJson.set("turb", turb);
  sensorJson.set("temp", temp);
  sensorJson.set("ts", (int64_t)tsMs);   // <-- add this field
  Firebase.RTDB.setJSON(&fbdo, devicePath + "/sensors", &sensorJson);

  // 2. Write history entry (new)
  String histPath = devicePath + "/history/" + String((int64_t)tsMs);
  FirebaseJson histJson;
  histJson.set("ts", (int64_t)tsMs);
  histJson.set("ph", ph);
  histJson.set("do", doVal);
  histJson.set("turb", turb);
  histJson.set("temp", temp);
  Firebase.RTDB.setJSON(&fbdo, histPath, &histJson);
}
```

### Why use `time(nullptr) * 1000`?

The app queries history using `orderByChild('ts')` with millisecond range filters. Using ms keeps it consistent with JavaScript's `Date.now()`.

### NTP timezone note

`configTime(0, 0, ...)` uses UTC. That's fine — the app stores and queries in UTC ms and converts to local time only for display.

---

## Option B — Firebase Cloud Function mirrors `/sensors` into `/history`

Use this if you can't modify the ESP32 firmware. The Cloud Function triggers on every write to `/sensors` and copies it into `/history/{ts}` automatically.

### Prerequisites

```bash
npm install -g firebase-tools
firebase login
firebase init functions   # choose JavaScript, select your project
```

### Function code

`functions/index.js`:

```js
const { onValueWritten } = require('firebase-functions/v2/database');
const admin = require('firebase-admin');

admin.initializeApp();

exports.mirrorSensorsToHistory = onValueWritten(
  '/devices/{deviceId}/sensors',
  async (event) => {
    const data = event.data.after.val();
    if (!data) return null;

    const deviceId = event.params.deviceId;

    // Use the ts field from the payload, or fall back to server time
    const ts = (data.ts && Number.isFinite(Number(data.ts)))
      ? Number(data.ts)
      : Date.now();

    const entry = {
      ts,
      ph:   data.ph   ?? null,
      do:   data.do   ?? null,
      turb: data.turb ?? null,
      temp: data.temp ?? null,
    };

    const histPath = `/devices/${deviceId}/history/${ts}`;
    return admin.database().ref(histPath).set(entry);
  }
);
```

### Deploy

```bash
firebase deploy --only functions
```

Once deployed, every time the ESP32 writes to `/sensors`, the function automatically copies it to `/history/{ts}` — no browser needed.

---

## Keeping history from growing forever

Add a second Cloud Function (or a scheduled function) to prune entries older than 35 days:

```js
const { onSchedule } = require('firebase-functions/v2/scheduler');

exports.pruneHistory = onSchedule('every 24 hours', async () => {
  const db = admin.database();
  const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;

  const devicesSnap = await db.ref('/devices').once('value');
  const promises = [];

  devicesSnap.forEach(deviceSnap => {
    const histRef = db.ref(`/devices/${deviceSnap.key}/history`);
    const q = histRef.orderByChild('ts').endAt(cutoff);
    promises.push(
      q.once('value').then(snap => {
        const updates = {};
        snap.forEach(child => { updates[child.key] = null; });
        return Object.keys(updates).length ? histRef.update(updates) : null;
      })
    );
  });

  return Promise.all(promises);
});
```

---

## RTDB rules for history

Update `database.rules.json` to lock down history writes to authenticated users only:

```json
{
  "rules": {
    "devices": {
      "$deviceId": {
        "sensors": { ".read": true, ".write": true },
        "feeding": { ".read": true, ".write": true },
        "history": {
          ".read": "auth != null",
          ".write": "auth != null",
          "$ts": {
            ".validate": "newData.hasChildren(['ts','ph','do','turb','temp'])"
          }
        }
      }
    }
  }
}
```

Deploy rules:
```bash
firebase deploy --only database
```

---

## Summary

| Approach | Requires firmware change | Works offline (no browser) | Complexity |
|---|---|---|---|
| Option A — ESP32 writes history | Yes | Yes | Low |
| Option B — Cloud Function mirror | No | Yes | Medium |
| Current (browser only) | No | No | None |

Option A is preferred for new builds. Option B is the drop-in solution if the ESP32 firmware is locked.
