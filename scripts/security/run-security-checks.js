const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

function fail(msg) {
  process.stderr.write(`${msg}\n`);
  process.exitCode = 1;
}

async function runNpmAudit() {
  // Use `--json` so we can gate on severity in a stable way.
  // Note: npm exits non-zero when vulnerabilities exist; we handle that.
  try {
    const cmd = process.platform === 'win32' ? (process.env.comspec || 'cmd.exe') : 'sh';
    const args =
      process.platform === 'win32'
        ? ['/d', '/s', '/c', 'npm audit --json']
        : ['-lc', 'npm audit --json'];
    const { stdout } = await execFileAsync(cmd, args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return { ok: true, json: JSON.parse(stdout) };
  } catch (e) {
    const stdout = e?.stdout || '';
    try {
      return { ok: false, json: JSON.parse(stdout) };
    } catch {
      return { ok: false, json: null, raw: String(stdout || e?.message || e) };
    }
  }
}

function summarizeAudit(auditJson) {
  // npm v10+ uses `metadata.vulnerabilities`
  const v = auditJson?.metadata?.vulnerabilities || {};
  return {
    info: v.info || 0,
    low: v.low || 0,
    moderate: v.moderate || 0,
    high: v.high || 0,
    critical: v.critical || 0,
  };
}

async function main() {
  // Default thesis-friendly behavior: fail only on critical vulnerabilities.
  // Override via SECURITY_FAIL_LEVEL=high|moderate|low|info|none
  const failLevel = String(process.env.SECURITY_FAIL_LEVEL || 'critical').toLowerCase();

  const audit = await runNpmAudit();
  if (!audit.json) {
    fail('[security] npm audit output could not be parsed.');
    if (audit.raw) process.stderr.write(`${audit.raw}\n`);
    return;
  }

  const summary = summarizeAudit(audit.json);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ok: audit.ok, auditSummary: summary }, null, 2));

  const shouldFail = (level) => {
    const order = ['none', 'info', 'low', 'moderate', 'high', 'critical'];
    return order.indexOf(level) >= order.indexOf(failLevel);
  };

  if (shouldFail('critical') && summary.critical > 0) fail(`[security] FAIL: ${summary.critical} critical vulnerabilities`);
  if (shouldFail('high') && summary.high > 0) fail(`[security] FAIL: ${summary.high} high vulnerabilities`);
  if (shouldFail('moderate') && summary.moderate > 0) fail(`[security] FAIL: ${summary.moderate} moderate vulnerabilities`);
  if (shouldFail('low') && summary.low > 0) fail(`[security] FAIL: ${summary.low} low vulnerabilities`);
  if (shouldFail('info') && summary.info > 0) fail(`[security] FAIL: ${summary.info} info vulnerabilities`);
}

main().catch((e) => {
  fail(`[security] ERROR: ${e?.message || e}`);
});

