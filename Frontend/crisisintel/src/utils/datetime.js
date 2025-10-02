// Lightweight datetime helpers

// Format like: Sat, Sep 20, 2025 at 3:30 PM
export function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

// Human relative time such as: in 2h, tomorrow, 3d ago
export function fromNow(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = d - now; // positive if in future
    const abs = Math.abs(diffMs);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (abs < minute) return diffMs >= 0 ? 'in < 1m' : '< 1m ago';
    if (abs < hour) {
      const m = Math.round(abs / minute);
      return diffMs >= 0 ? `in ${m}m` : `${m}m ago`;
    }
    if (abs < day) {
      const h = Math.round(abs / hour);
      return diffMs >= 0 ? `in ${h}h` : `${h}h ago`;
    }
    const dcount = Math.round(abs / day);
    return diffMs >= 0 ? `in ${dcount}d` : `${dcount}d ago`;
  } catch {
    return '';
  }
}

export function statusVariant(status) {
  switch ((status || '').toLowerCase()) {
    case 'booked': return 'success';
    case 'cancel_requested': return 'warn';
    case 'cancelled': return 'danger';
    case 'done': return 'success';
    default: return 'outline';
  }
}
