const autocannon = require('autocannon');

function envNumber(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envMs(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

async function runOne({ url, connections, durationSeconds, pipelining }) {
  const res = await autocannon({
    url,
    connections,
    duration: durationSeconds,
    pipelining,
    headers: {
      // Ensure Express doesn't do unexpected content negotiation work.
      Accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
    },
  });
  return res;
}

function pct(res, key) {
  return res?.latency?.[key] ?? null;
}

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exitCode = 1;
}

async function main() {
  const baseUrl = process.env.PERF_BASE_URL || 'http://localhost:3000';
  const connections = envNumber('PERF_CONNECTIONS', 20);
  const durationSeconds = envNumber('PERF_DURATION_SECONDS', 10);
  const pipelining = envNumber('PERF_PIPELINING', 1);

  const p95MaxMs = envMs('PERF_P95_MAX_MS', 250);
  const errorRateMax = Number(process.env.PERF_ERROR_RATE_MAX ?? '0.01');

  const targets = [
    { name: 'config', path: '/api/config' },
    { name: 'spa', path: '/' },
  ];

  const results = [];
  for (const t of targets) {
    const url = `${baseUrl}${t.path}`;
    // eslint-disable-next-line no-console
    console.log(`[perf] ${t.name}: ${url} (${connections} conns, ${durationSeconds}s)`);
    const r = await runOne({ url, connections, durationSeconds, pipelining });
    results.push({ name: t.name, url, result: r });
  }

  const summary = results.map(({ name, url, result }) => {
    const p95 = pct(result, 'p95');
    const errors = (result.errors || 0) + (result.timeouts || 0);
    const requests = result.requests?.total || 0;
    const errorRate = requests > 0 ? errors / requests : 0;
    return {
      name,
      url,
      p95Ms: p95,
      rpsAvg: result.requests?.average ?? null,
      errors,
      timeouts: result.timeouts ?? 0,
      errorRate,
    };
  });

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: true, thresholds: { p95MaxMs, errorRateMax }, summary }, null, 2));

  for (const s of summary) {
    if (s.p95Ms != null && s.p95Ms > p95MaxMs) {
      fail(`[perf] FAIL ${s.name}: p95 ${s.p95Ms}ms > ${p95MaxMs}ms`);
    }
    if (s.errorRate > errorRateMax) {
      fail(`[perf] FAIL ${s.name}: errorRate ${(s.errorRate * 100).toFixed(2)}% > ${(errorRateMax * 100).toFixed(2)}%`);
    }
  }
}

main().catch((e) => {
  process.stderr.write(`[perf] ERROR: ${e?.message || e}\n`);
  process.exitCode = 1;
});

