import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

/**
 * Route guard component. Redirects to root (Sign In) when no auth token present.
 */
export default function RequireAuth({ children }) {
  const token = localStorage.getItem('authToken');
  const location = useLocation();
  if (!token) {
    return <Navigate to="/" state={{ from: location }} replace />;
  }
  return children;
}
