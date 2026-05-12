/**
 * UniSMS — shared send + PH phone normalization for SMS routes and alert dispatch.
 */

export function getUniSmsAuthHeader() {
  const secretKey = process.env.UNISMS_SECRET_KEY || '';
  if (!secretKey) return null;
  const token = Buffer.from(`${secretKey}:`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

export function normalizePhPhoneToE164(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const cleaned = raw.replace(/[^\d+]/g, '');

  if (/^\+639\d{9}$/.test(cleaned)) return cleaned;
  if (/^639\d{9}$/.test(cleaned)) return `+${cleaned}`;
  if (/^09\d{9}$/.test(cleaned)) return `+63${cleaned.slice(1)}`;

  return cleaned;
}

/**
 * @returns {{ ok: boolean, reference_id?: string, error?: string, status?: number }}
 */
export async function sendUniSms({ recipient, content, metadata, sender_id }) {
  const authHeader = getUniSmsAuthHeader();
  if (!authHeader) {
    return { ok: false, error: 'UniSMS is not configured (missing UNISMS_SECRET_KEY).' };
  }

  const to = normalizePhPhoneToE164(recipient);
  const msg = String(content || '').trim();
  if (!to) return { ok: false, error: 'recipient is required.' };
  if (!msg) return { ok: false, error: 'content is required.' };
  if (msg.length > 160) return { ok: false, error: 'content must be <= 160 characters.' };

  const senderId = String(sender_id || process.env.UNISMS_SENDER_ID || '').trim();

  function stripNonAscii(s) {
    return String(s || '')
      .split('')
      .map((ch) => (ch.charCodeAt(0) <= 0x7f ? ch : '?'))
      .join('');
  }

  async function postSmsBody(body) {
    const resp = await fetch('https://unismsapi.com/api/sms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    return { resp, data };
  }

  async function trySend(includeSenderId, includeMetadata, messageText) {
    const body = { recipient: to, content: String(messageText || msg).trim() };
    if (includeMetadata && metadata && typeof metadata === 'object') {
      body.metadata = metadata;
    }
    if (includeSenderId && senderId) body.sender_id = senderId;
    return postSmsBody(body);
  }

  let { resp, data } = await trySend(true, true, msg);

  if (!resp.ok && resp.status === 422 && senderId) {
    ({ resp, data } = await trySend(false, true, msg));
  }

  if (!resp.ok && resp.status === 422) {
    ({ resp, data } = await trySend(false, false, msg));
  }

  if (!resp.ok && resp.status === 422) {
    const ascii = stripNonAscii(msg);
    if (ascii !== msg && ascii.trim()) {
      ({ resp, data } = await trySend(false, false, ascii));
    }
  }

  if (!resp.ok) {
    const detail = data?.error || data?.message || `UniSMS request failed with ${resp.status}`;
    return { ok: false, error: detail, status: resp.status };
  }

  const referenceId = data?.message?.reference_id || null;
  return { ok: true, reference_id: referenceId };
}
