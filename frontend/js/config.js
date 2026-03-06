/**
 * Loads public config from backend /api/config (env-based).
 * When running without backend, returns empty config so user can enter URL manually.
 */
const API_CONFIG_PATH = '/api/config';

export async function getConfig() {
  try {
    const res = await fetch(API_CONFIG_PATH, { method: 'GET' });
    if (!res.ok) return {};
    const data = await res.json();
    return {
      firebaseDatabaseUrl: data.firebaseDatabaseUrl || '',
      deviceId: data.deviceId || 'device001',
    };
  } catch {
    return {};
  }
}
