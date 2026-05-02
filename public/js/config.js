/**
 * Loads public config from backend /api/config (env-based).
 * When running without backend, returns empty config so user can enter URL manually.
 */
const API_CONFIG_PATH = '/api/config';

export async function getConfig() {
  async function tryFetchJson(url) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  // 1) Preferred in local dev: backend provides env-based config.
  const data = await tryFetchJson(API_CONFIG_PATH);
  if (data) {
    return {
      firebaseDatabaseUrl: data.firebaseDatabaseUrl || data.firebase?.databaseURL || '',
      deviceId: data.deviceId || 'device001',
      firebase: {
        apiKey: data.firebase?.apiKey || '',
        authDomain: data.firebase?.authDomain || '',
        projectId: data.firebase?.projectId || '',
        storageBucket: data.firebase?.storageBucket || '',
        messagingSenderId: data.firebase?.messagingSenderId || '',
        appId: data.firebase?.appId || '',
        databaseURL: data.firebase?.databaseURL || data.firebaseDatabaseUrl || '',
      },
      emailjsPublicKey: data.emailjsPublicKey || '',
      emailjsServiceId: data.emailjsServiceId || '',
      emailjsTemplateId: data.emailjsTemplateId || '',
    };
  }

  // 2) Firebase Hosting fallback: auto-provided config.
  // This enables graphs/reports to load RTDB data even when no backend is running.
  const hosted = await tryFetchJson('/__/firebase/init.json');
  if (hosted) {
    return {
      firebaseDatabaseUrl: hosted.databaseURL || '',
      deviceId: hosted.deviceId || 'device001',
      firebase: {
        apiKey: hosted.apiKey || '',
        authDomain: hosted.authDomain || '',
        projectId: hosted.projectId || '',
        storageBucket: hosted.storageBucket || '',
        messagingSenderId: hosted.messagingSenderId || '',
        appId: hosted.appId || '',
        databaseURL: hosted.databaseURL || '',
      },
      emailjsPublicKey: hosted.emailjsPublicKey || '',
      emailjsServiceId: hosted.emailjsServiceId || '',
      emailjsTemplateId: hosted.emailjsTemplateId || '',
    };
  }

  return {};
}
