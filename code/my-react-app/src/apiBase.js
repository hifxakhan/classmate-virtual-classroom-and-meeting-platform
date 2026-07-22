/**
 * Flask API origin for fetch/axios.
 *
 * Resolution order:
 *   1. VITE_API_URL, when it is a real absolute backend origin
 *      (and not the frontend's own origin — that would hit the SPA fallback
 *       and return index.html, causing "Unexpected token '<'" JSON errors).
 *   2. http://localhost:5000 during local development.
 *   3. The deployed Flask backend on Railway in production.
 */
const PROD_API = 'https://classmate-virtual-classroom-and-meeting-platform-production.up.railway.app';

export function getApiBase() {
  const raw = String(import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

  // 1. Explicit, absolute backend URL that isn't the frontend's own origin.
  if (/^https?:\/\//i.test(raw) && raw !== origin) {
    return raw;
  }

  // 2. Local development.
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(hostname)) {
    return 'http://localhost:5000';
  }

  // 3. Production fallback — never return a relative/empty base (would hit the SPA).
  return PROD_API;
}
