const fs = require('node:fs');

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const row = {};
    header.forEach((k, idx) => {
      row[k] = cols[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function metrics(pairs) {
  // pairs: [{sensor, ref}]
  const n = pairs.length;
  if (n === 0) return { n: 0, mae: null, rmse: null, bias: null, mape: null };

  let sumAbs = 0;
  let sumSq = 0;
  let sumErr = 0;
  let mapeCount = 0;
  let sumApe = 0;

  for (const { sensor, ref } of pairs) {
    const err = sensor - ref;
    sumAbs += Math.abs(err);
    sumSq += err * err;
    sumErr += err;
    if (ref !== 0) {
      sumApe += Math.abs(err / ref);
      mapeCount++;
    }
  }

  return {
    n,
    mae: sumAbs / n,
    rmse: Math.sqrt(sumSq / n),
    bias: sumErr / n,
    mape: mapeCount ? sumApe / mapeCount : null,
  };
}

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exitCode = 1;
}

function pickMetricThresholds(sensorKey) {
  // Defaults: set conservatively; override per-run via env.
  // Thesis tip: justify these thresholds based on sensor spec sheet / literature.
  const env = (name, fallback) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) ? v : fallback;
  };

  const upperKey = sensorKey.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const preset =
    sensorKey === 'turb'
      ? { maeMax: 5, rmseMax: 7, biasAbsMax: 5 }
      : sensorKey === 'temp'
        ? { maeMax: 0.5, rmseMax: 0.75, biasAbsMax: 0.5 }
        : sensorKey === 'do'
          ? { maeMax: 0.5, rmseMax: 0.75, biasAbsMax: 0.5 }
          : { maeMax: 0.25, rmseMax: 0.35, biasAbsMax: 0.25 };
  return {
    maeMax: env(`ACC_${upperKey}_MAE_MAX`, env('ACC_MAE_MAX', preset.maeMax)),
    rmseMax: env(`ACC_${upperKey}_RMSE_MAX`, env('ACC_RMSE_MAX', preset.rmseMax)),
    biasAbsMax: env(`ACC_${upperKey}_BIAS_ABS_MAX`, env('ACC_BIAS_ABS_MAX', preset.biasAbsMax)),
  };
}

function main() {
  const args = process.argv.slice(2);
  const inputArgIdx = args.indexOf('--input');
  const inputPath =
    (inputArgIdx >= 0 ? args[inputArgIdx + 1] : null) ||
    (args[0] && !String(args[0]).startsWith('-') ? args[0] : null);

  if (!inputPath) {
    fail('Usage: node scripts/accuracy/evaluate-accuracy.js data/accuracy.csv');
    return;
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    fail(`[accuracy] No rows found in ${inputPath}`);
    return;
  }

  // Detect columns like sensor_ph/ref_ph, sensor_do/ref_do, etc.
  const cols = Object.keys(rows[0]);
  const sensorCols = cols.filter((c) => c.startsWith('sensor_'));

  const out = {
    input: inputPath,
    generatedAt: new Date().toISOString(),
    sensors: {},
    ok: true,
  };

  for (const sCol of sensorCols) {
    const key = sCol.replace('sensor_', '');
    const rCol = `ref_${key}`;
    if (!cols.includes(rCol)) continue;

    const pairs = [];
    for (const row of rows) {
      const sensor = toNumber(row[sCol]);
      const ref = toNumber(row[rCol]);
      if (sensor == null || ref == null) continue;
      pairs.push({ sensor, ref });
    }

    const m = metrics(pairs);
    const t = pickMetricThresholds(key);
    const checks = {
      maeOk: m.mae == null ? false : m.mae <= t.maeMax,
      rmseOk: m.rmse == null ? false : m.rmse <= t.rmseMax,
      biasOk: m.bias == null ? false : Math.abs(m.bias) <= t.biasAbsMax,
    };

    const ok = checks.maeOk && checks.rmseOk && checks.biasOk;
    if (!ok) out.ok = false;

    out.sensors[key] = {
      n: m.n,
      metrics: m,
      thresholds: t,
      checks,
      ok,
    };
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));

  if (!out.ok) fail('[accuracy] FAIL: one or more sensors exceed thresholds');
}

main();

