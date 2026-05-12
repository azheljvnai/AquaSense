/**
 * EmailJS REST credentials for server-side sends (dispatch-alert).
 * The browser only needs the public key; the server also needs the account private key
 * (EmailJS dashboard → Account → API keys → Private Key), exposed here as accessToken.
 */

export function getEmailJsServerEnv() {
  const privateKey = (
    process.env.EMAILJS_PRIVATE_KEY ||
    process.env.EMAILJS_ACCESS_TOKEN ||
    process.env.EMAILJS_PRIVATE_API_KEY ||
    ''
  ).trim();
  const publicKey = (process.env.EMAILJS_PUBLIC_KEY || '').trim();
  const serviceId = (process.env.EMAILJS_SERVICE_ID || '').trim();
  const templateId = (process.env.EMAILJS_TEMPLATE_ID || '').trim();

  const configured = !!(privateKey && publicKey && serviceId && templateId);
  const missing = [];
  if (!privateKey) {
    missing.push('EMAILJS_PRIVATE_KEY (or EMAILJS_ACCESS_TOKEN — same value as EmailJS “Private Key”)');
  }
  if (!publicKey) missing.push('EMAILJS_PUBLIC_KEY');
  if (!serviceId) missing.push('EMAILJS_SERVICE_ID');
  if (!templateId) missing.push('EMAILJS_TEMPLATE_ID');

  return { privateKey, publicKey, serviceId, templateId, configured, missing };
}
