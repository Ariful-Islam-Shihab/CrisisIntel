import React, { useEffect, useState } from 'react';

/**
 * Global transient toast listener.
 * Listens for 'api-error' + 'api-auth-required' window events dispatched by api.js.
 */
function prettifyMessage(msg) {
  if (!msg) return 'Something went wrong';
  // Strip common prefixes like "HTTP 400: "
  const clean = String(msg).replace(/^HTTP\s+\d+:\s*/i, '');
  const key = clean.trim().toLowerCase();
  // Map known server codes to friendly copy
  const map = {
    outside_window: 'Selected time is outside the booking window for this service.',
    capacity_reached: 'Daily capacity for this service is full on the selected date.',
    max_per_day_reached: 'Daily capacity for this service is full on the selected date.',
    one_per_day: 'You already have a booking for this service on that day.',
    overlap: 'Your selected time overlaps with an existing booking.',
    not_available: 'This service is currently unavailable.',
    service_unavailable: 'This service is currently unavailable.',
    too_late: 'This action is only allowed up to 2 hours before the appointment.',
    not_supported: 'This action is not supported.',
    not_found: "We couldn't find what you were looking for.",
    missing: "We couldn't find what you were looking for.",
    forbidden: 'You do not have permission to do that.',
    not_doctor: 'Doctor access only.',
    unauthorized: 'Please sign in again.',
  };
  if (map[key]) return map[key];
  return clean;
}

export default function Toast() {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [classes, setClasses] = useState('');

  useEffect(() => {
    const onError = (e) => {
      setMessage(prettifyMessage(e.detail?.message));
      setClasses('bg-red-600 text-white');
      setVisible(true);
      setTimeout(() => setVisible(false), 3500);
    };
    const onAuth = () => {
      setMessage('Please sign in again');
      setClasses('bg-yellow-500 text-black');
      setVisible(true);
      setTimeout(() => setVisible(false), 2500);
    };
    const onToast = (e) => {
      const type = (e.detail?.type || 'info').toLowerCase();
      const msg = e.detail?.message || '';
      setMessage(prettifyMessage(msg));
      const style = type === 'success' ? 'bg-green-600 text-white'
        : type === 'warning' ? 'bg-yellow-500 text-black'
        : type === 'error' ? 'bg-red-600 text-white'
        : 'bg-blue-600 text-white';
      setClasses(style);
      setVisible(true);
      setTimeout(() => setVisible(false), type === 'success' ? 2200 : 3000);
    };
    window.addEventListener('api-error', onError);
    window.addEventListener('api-auth-required', onAuth);
    window.addEventListener('toast', onToast);
    return () => {
      window.removeEventListener('api-error', onError);
      window.removeEventListener('api-auth-required', onAuth);
      window.removeEventListener('toast', onToast);
    };
  }, []);

  if (!visible) return null;

  return (
    <div className={`fixed right-8 bottom-8 px-5 py-4 rounded-xl shadow-lg transition ${classes}`}>
      {message}
    </div>
  );
}
