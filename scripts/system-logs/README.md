# System logs seed dataset

Seeds Firestore `system_logs` with a light **recent** sample (farm users from User Management) and the full **evaluation** window for User1–User10.

## Prerequisites

- Firebase Admin credentials (`FIREBASE_SERVICE_ACCOUNT_JSON` or `serviceAccountKey.json` at repo root)
- At least one document in Firestore `users` (for recent log actors)
- Firestore composite indexes for `system_logs` deployed and **Enabled**

## Commands

```bash
# Preview counts (no writes)
npm run system-logs:seed -- --dry-run

# Replace prior seed run (only docs tagged aquasense-eval-2026-v1), then insert
npm run system-logs:seed -- --replace-tagged

# Recent farm-user logs or evaluation only
npm run system-logs:seed -- --only recent --replace-tagged
npm run system-logs:seed -- --only evaluation --replace-tagged

# Verify distributions after seeding
npm run system-logs:seed -- --verify
```

## Dataset summary

| Window | Dates | Users | Approx. logs |
|--------|-------|-------|----------------|
| Recent | May 20 → today (excludes May 25–28) | Real Firestore `users` | ~20 |
| Evaluation | May 25 – 28, 2026 | User1 … User10 (`eval-respondent-01` … `10`) | ~85 |
| **Total** | | | **~105** |

Evaluation assignments are defined in [`eval-manifest-2026.json`](eval-manifest-2026.json).

## Thesis metrics encoded (evaluation)

- Dashboard access: 4 under 1 min, 6 at 1–2 min (metadata on `dashboard.access`)
- Feeding schedule config: 3 / 5 / 2 duration buckets; 6 / 3 / 1 attempt counts
- No operational errors (May 25–28); validation warnings only for retry attempts
- One `user.assistance_request` (User7)
- Ten full alert chains: threshold → generated → notification_sent → acknowledged
- Ten successful automated feed completions (metadata flags servo/automated)
- Sensor accuracy: 4 Very Accurate, 6 Accurate on `sensor.reading`

## Re-run safety

`--replace-tagged` deletes only documents where `seedBatch` (or `metadata.seedBatch`) equals `aquasense-eval-2026-v1`. Manually created logs are not removed.

## Troubleshooting

If the System Logs UI shows index errors, wait until indexes are **Enabled** in the [Firebase Console → Firestore → Indexes](https://console.firebase.google.com/project/aquasense-bf80d/firestore/indexes), or use the API fallback built into the app.
