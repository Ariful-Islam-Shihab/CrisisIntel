import React, { useEffect, useState } from 'react';
import api from '../api';

export default function Admin() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const role = String(me?.role || '').toLowerCase();
  const isAdmin = role.includes('admin') || me?.is_admin === true || me?.isAdmin === true;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError(null);
      try {
        const d = await api.geoStats();
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  if (!isAdmin) return <div className="p-4 bg-white border rounded">Admins only.</div>;
  if (loading) return <div className="p-4 bg-white border rounded">Loading...</div>;
  if (error) return <div className="p-4 bg-white border rounded text-red-600">{error}</div>;

  const card = (title, rows=[]) => (
    <div className="p-4 bg-white border rounded">
      <div className="font-semibold mb-2">{title}</div>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        {rows.map(([k,v]) => (
          <React.Fragment key={k}>
            <dt className="text-gray-500">{k}</dt>
            <dd className="text-right font-medium">{v ?? '—'}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin Dashboard</h1>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {card('Fire Departments', [
          ['Total', data?.fire_departments?.total],
          ['With Coordinates', data?.fire_departments?.with_coords],
          ['Without Coordinates', data?.fire_departments?.without_coords],
        ])}
        {card('Fire Requests', [
          ['Total', data?.fire_requests?.total],
          ['With Coordinates', data?.fire_requests?.with_coords],
          ['Without Coordinates', data?.fire_requests?.without_coords],
          ['Pending (with candidates)', data?.fire_requests?.pending_with_candidates],
          ['Pending (without candidates)', data?.fire_requests?.pending_without_candidates],
        ])}
        {card('Users', [
          ['Total', data?.users?.total],
          ['With Last Location', data?.users?.with_last_location],
          ['Without Last Location', data?.users?.without_last_location],
        ])}
      </div>
    </div>
  );
}
