/**
 * Path-based SPA routing for AquaSense.
 * Maps URL pathnames to internal page ids (data-page values).
 */

/** @type {Record<string, string>} */
const PATH_TO_PAGE = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/water-quality': 'water-quality',
  '/historical-data': 'historical-data',
  '/feeding': 'feeding',
  '/alerts': 'alerts',
  '/reports': 'reports',
  '/configuration': 'configuration',
  '/user-management': 'user-management',
  '/system-logs': 'system-logs',
  '/account': 'account-profile',
};

/** @type {Record<string, string>} */
const PAGE_TO_PATH = {
  dashboard: '/',
  'water-quality': '/water-quality',
  'historical-data': '/historical-data',
  feeding: '/feeding',
  alerts: '/alerts',
  reports: '/reports',
  configuration: '/configuration',
  'user-management': '/user-management',
  'system-logs': '/system-logs',
  'account-profile': '/account',
};

/**
 * Normalize a pathname and return the page id, or null if unknown.
 * @param {string} pathname
 * @returns {string | null}
 */
export function pageFromPath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  return PATH_TO_PAGE[path] ?? null;
}

/**
 * Return the canonical URL path for a page id.
 * @param {string} page
 * @returns {string}
 */
export function pathFromPage(page) {
  return PAGE_TO_PATH[page] ?? '/';
}

/**
 * Register popstate handler for browser back/forward.
 * @param {(page: string, opts: { replace?: boolean }) => void} onNavigate
 */
export function initRouter(onNavigate) {
  window.addEventListener('popstate', () => {
    const page = pageFromPath(window.location.pathname) ?? 'dashboard';
    onNavigate(page, { replace: false });
  });
}
