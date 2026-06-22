import { Navigate } from 'react-router-dom';

/**
 * Wraps any route that requires authentication.
 * If no token is found in localStorage the user is redirected to the
 * login page. The `replace` prop removes the protected route from the
 * history stack so the back button cannot return there after logout.
 */
function ProtectedRoute({ children }) {
  const token = localStorage.getItem('token');
  if (!token) {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default ProtectedRoute;
