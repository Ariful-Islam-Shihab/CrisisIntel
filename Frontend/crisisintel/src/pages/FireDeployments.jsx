import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

export default function FireDeployments() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const roleStr = String(me?.role ?? '').toLowerCase();
  const rolesList = Array.isArray(me?.roles) ? me.roles.map(r => String(r).toLowerCase()) : [];
  const isFireService = roleStr.includes('fire') || rolesList.some(r => r.includes('fire'));
  const isFireStaff = (() => {
    // Honor cached probe result from NavBar if available
    try {
      const val = localStorage.getItem(`isFireUser:${me?.id || '0'}`);
      return val === '1';
    } catch { return false; }
  })();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all'); // active|completed|all (default to all, includes past)

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    api.fireActivities()
      .then(r => {
        if (cancelled) return;
        const rows = (r?.results || r?.items || r || []);
        setItems(Array.isArray(rows) ? rows : []);
      })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load deployments'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => {
    const norm = (items || []).map(x => ({
      id: x.id || x.request_id || x.deployment_id || Math.random().toString(36).slice(2),
      request_id: x.request_id ?? x.fire_request_id ?? x.id,
      department_name: x.assigned_department_name || x.department_name || x.dept_name || null,
      team_name: x.assigned_team_name || x.team_name || null,
      status: String(x.status || '').toLowerCase(),
      note: x.note || x.activity_note || null,
      created_at: x.created_at || x.assigned_team_at || x.started_at || null,
      completed_at: x.completed_at || null,
      location_text: x.location_text || null,
    }));
    const active = norm.filter(a => !a.completed_at && a.status !== 'completed' && a.status !== 'withdrawn');
    const completed = norm.filter(a => a.completed_at || a.status === 'completed' || a.status === 'withdrawn');
    return { active, completed, all: norm };
  }, [items]);

  if (!isFireService && !isFireStaff) return (
    <div className="p-4 bg-white border rounded">This page is for fire service users.</div>
  );

  return (
    <div className="p-4 bg-white border rounded">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Fire Deployments</h2>
        <div className="space-x-2 text-sm">
          {['active','completed','all'].map(key => (
            <button key={key}
              onClick={() => setFilter(key)}
              className={`px-2 py-1 rounded border ${filter===key? 'bg-orange-50 border-orange-300 text-orange-700' : 'bg-gray-50 border-gray-200 text-gray-700'}`}
            >{key[0].toUpperCase()+key.slice(1)}</button>
          ))}
        </div>
      </div>

      {loading && <div className="text-sm text-gray-600">Loading deployments…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}

      {!loading && !error && groups[filter].length === 0 && (
        <div className="text-sm text-gray-600">
          No {filter === 'all' ? '' : filter + ' '}deployments.
        </div>
      )}

      {!loading && !error && groups[filter].length > 0 && (
        <ul className="divide-y">
          {groups[filter].map(a => (
            <li key={`${a.id}-${a.request_id}`} className="py-2 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Request #{a.request_id}</div>
                  <div className="text-gray-600">
                    {a.team_name ? `Team: ${a.team_name}` : 'Team: —'}
                    {a.department_name ? ` · Dept: ${a.department_name}` : ''}
                  </div>
                  {a.location_text && (
                    <div className="text-[11px] text-gray-500">{a.location_text}</div>
                  )}
                  {a.note && (
                    <div className="text-[11px] text-gray-500">Note: {a.note}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className={`text-xs inline-block px-2 py-0.5 rounded ${a.completed_at || a.status==='completed' ? 'bg-gray-100 text-gray-700' : 'bg-orange-100 text-orange-800'}`}>
                    {a.completed_at || a.status==='completed' ? 'Completed' : (a.status || 'Active')}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    {a.completed_at ? new Date(a.completed_at).toLocaleString() : (a.created_at ? new Date(a.created_at).toLocaleString() : '')}
                  </div>
                  <div className="mt-2">
                    <Link className="text-purple-700 hover:underline" to={`/fire/requests/${a.request_id}`}>Open</Link>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 text-xs text-gray-500">
        Tip: Manage your teams in <Link to="/fire-teams" className="text-indigo-700 hover:underline">Fire Teams</Link>.
      </div>
    </div>
  );
}
