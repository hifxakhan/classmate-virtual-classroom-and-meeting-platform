/**
 * Flask API origin for fetch/axios. Set VITE_API_URL in .env (e.g. http://localhost:5000).
 */
export function getApiBase() {
  const raw = import.meta.env.VITE_API_URL || 'http://localhost:5000';
  return String(raw).replace(/\/$/, '');
}
