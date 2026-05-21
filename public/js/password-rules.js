/**
 * Shared password validation rules (Account page + admin reset + create user).
 */

export const PASSWORD_RULES = [
  { id: 'rule-length', message: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'rule-upper', message: 'One uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'rule-lower', message: 'One lowercase letter', test: (p) => /[a-z]/.test(p) },
  { id: 'rule-number', message: 'One number', test: (p) => /\d/.test(p) },
];

/**
 * @param {string} password
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validatePassword(password) {
  const pw = String(password || '');
  const errors = PASSWORD_RULES.filter((r) => !r.test(pw)).map((r) => r.message);
  return { ok: errors.length === 0, errors };
}

/**
 * @param {string} password
 * @param {string} confirm
 */
export function passwordsMatch(password, confirm) {
  const pw = String(password || '');
  const c = String(confirm || '');
  return pw.length > 0 && pw === c;
}

/**
 * @param {HTMLElement | null} el
 * @param {'pending' | 'ok' | 'fail'} state
 */
export function setRuleState(el, state) {
  if (!el) return;
  el.classList.remove('rule-ok', 'rule-fail');
  if (state === 'ok') el.classList.add('rule-ok');
  else if (state === 'fail') el.classList.add('rule-fail');
}

/**
 * Update password requirement checklist elements in the DOM.
 * @param {{ password?: string, confirm?: string, ruleIdPrefix?: string, matchRuleId?: string }} opts
 */
export function syncPasswordChecklistUI(opts = {}) {
  const password = opts.password ?? '';
  const confirm = opts.confirm ?? '';
  const prefix = opts.ruleIdPrefix ?? '';
  const matchId = opts.matchRuleId ?? `${prefix}rule-match`;
  const touched = password.length > 0;

  PASSWORD_RULES.forEach(({ id, test }) => {
    const el = document.getElementById(`${prefix}${id}`);
    if (!touched) setRuleState(el, 'pending');
    else setRuleState(el, test(password) ? 'ok' : 'fail');
  });

  const matchEl = document.getElementById(matchId);
  if (!confirm.length && !password.length) setRuleState(matchEl, 'pending');
  else if (passwordsMatch(password, confirm)) setRuleState(matchEl, 'ok');
  else setRuleState(matchEl, 'fail');
}
