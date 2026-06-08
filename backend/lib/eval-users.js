/** Evaluation respondents User1–User10 — keep in sync with public/js/constants/eval-users.js */

export const EVAL_RESPONDENTS = [
  { userId: 'eval-respondent-01', userName: 'User1', joinedDate: '2026-05-25' },
  { userId: 'eval-respondent-02', userName: 'User2', joinedDate: '2026-05-25' },
  { userId: 'eval-respondent-03', userName: 'User3', joinedDate: '2026-05-25' },
  { userId: 'eval-respondent-04', userName: 'User4', joinedDate: '2026-05-26' },
  { userId: 'eval-respondent-05', userName: 'User5', joinedDate: '2026-05-26' },
  { userId: 'eval-respondent-06', userName: 'User6', joinedDate: '2026-05-26' },
  { userId: 'eval-respondent-07', userName: 'User7', joinedDate: '2026-05-27' },
  { userId: 'eval-respondent-08', userName: 'User8', joinedDate: '2026-05-27' },
  { userId: 'eval-respondent-09', userName: 'User9', joinedDate: '2026-05-28' },
  { userId: 'eval-respondent-10', userName: 'User10', joinedDate: '2026-05-28' },
];

export const EVAL_USER_IDS = new Set(EVAL_RESPONDENTS.map((r) => r.userId));

export function isEvalUserId(uid) {
  return EVAL_USER_IDS.has(uid);
}

export function evalUserEmail(userName) {
  return `${String(userName || 'user').toLowerCase()}@evaluation.local`;
}

/** Start of day Asia/Manila as Firestore Timestamp. */
export function joinedDateToTimestamp(admin, ymd) {
  const iso = `${ymd}T00:00:00+08:00`;
  return admin.firestore.Timestamp.fromDate(new Date(iso));
}
