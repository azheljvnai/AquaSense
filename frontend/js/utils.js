/**
 * Shared utilities: logging, water quality thresholds, badges, sparklines.
 */

export const thresh = {
  ph:   { ok: [6.5, 8.5], warn: [6.0, 9.0] },
  do:   { ok: [5.0, 9.0], warn: [4.0, 10.0] },
  turb: { ok: [0, 3.0], warn: [0, 5.0] },
  temp: { ok: [26, 30], warn: [24, 32] },
};

/** Returns { c: 'ok'|'warn'|'danger', l: 'Normal'|'Warning'|'Critical' } */
export function getBadge(key, val) {
  const t = thresh[key];
  if (!t) return { c: 'ok', l: 'Normal' };
  if (val >= t.ok[0] && val <= t.ok[1]) return { c: 'ok', l: 'Normal' };
  if (val >= t.warn[0] && val <= t.warn[1]) return { c: 'warn', l: 'Warning' };
  return { c: 'danger', l: 'Critical' };
}

export const spkData = { ph: [], do: [], turb: [], temp: [] };
export const spkCol = { ph: '#22c55e', do: '#3b82f6', turb: '#eab308', temp: '#ef4444' };

export function drawSpark(id, data, color) {
  const svg = document.getElementById('sp-' + id);
  if (!svg || data.length < 2) return;
  const W = svg.clientWidth || 220;
  const H = 28;
  const mn = Math.min(...data);
  const mx = Math.max(...data);
  const rng = mx - mn || 1;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - ((v - mn) / rng) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  svg.innerHTML = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.85"/>`;
}

export function log(msg, type = '') {
  const ul = document.getElementById('loglist');
  if (!ul) return;
  const li = document.createElement('li');
  li.className = 'l' + type;
  const time = new Date().toTimeString().split(' ')[0];
  li.innerHTML = `<span class="lt">${time}</span><span class="lm">${msg}</span>`;
  ul.prepend(li);
  while (ul.children.length > 60) ul.removeChild(ul.lastChild);
}
