/**
 * Clears the entire session and navigates to the login page.
 * Using { replace: true } replaces the current history entry so the
 * browser back button cannot return to a protected dashboard.
 */
export function performLogout(navigate) {
  localStorage.clear();
  navigate('/', { replace: true });
}
