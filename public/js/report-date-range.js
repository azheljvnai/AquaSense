/**
 * Report period boundaries (daily / weekly / monthly / custom).
 * Weekly = calendar Mon 00:00 – Sun 23:59:59 local; monthly = calendar month.
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

export function fmtReportDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * @param {'daily'|'weekly'|'monthly'|'custom'|string} period
 * @param {string} [customFrom] - YYYY-MM-DD
 * @param {string} [customTo] - YYYY-MM-DD
 * @param {Date} [now]
 * @returns {{ from: Date, to: Date, label: string }}
 */
export function getReportDateRange(period, customFrom, customTo, now = new Date()) {
  if (period === 'daily') {
    const s = new Date(now);
    s.setHours(0, 0, 0, 0);
    const e = new Date(now);
    e.setHours(23, 59, 59, 999);
    return { from: s, to: e, label: `Today (${fmtReportDate(now)})` };
  }
  if (period === 'weekly') {
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() + (day === 0 ? -6 : 1 - day));
    mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return {
      from: mon,
      to: sun,
      label: `This week (${fmtReportDate(mon)} Mon – ${fmtReportDate(sun)} Sun)`,
    };
  }
  if (period === 'monthly') {
    const s = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from: s, to: e, label: `This month (${fmtReportDate(s)} – ${fmtReportDate(e)})` };
  }
  if (period === 'custom' && customFrom && customTo) {
    return {
      from: new Date(`${customFrom}T00:00:00`),
      to: new Date(`${customTo}T23:59:59`),
      label: `${customFrom} – ${customTo}`,
    };
  }
  const s = new Date(now);
  s.setHours(0, 0, 0, 0);
  const e = new Date(now);
  e.setHours(23, 59, 59, 999);
  return { from: s, to: e, label: fmtReportDate(now) };
}
