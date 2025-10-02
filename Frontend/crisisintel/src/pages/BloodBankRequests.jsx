import React, { useEffect, useMemo, useState } from 'react';
import api from '../api';

export default function BloodBankRequests() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState({}); // id -> true

  const isBloodBank = typeof me?.role === 'string' && me.role.toLowerCase().includes('blood');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.listInventoryRequests({ bank_user_id: me?.id });
      setItems(r.results || r.items || []);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const act = async (id, status, extra={}) => {
    setBusy(x => ({ ...x, [id]: true }));
    try {
      await api.updateInventoryRequestStatus(id, status, extra);
      await load();
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: `Request ${status}` } }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Action failed' } }));
    } finally {
      setBusy(x => { const y = { ...x }; delete y[id]; return y; });
    }
  };

  const columns = useMemo(() => ([
    { key: 'id', label: 'ID' },
    { key: 'requester_name', label: 'Requester' },
    { key: 'blood_type', label: 'Blood' },
    { key: 'quantity_units', label: 'Units' },
    { key: 'target_datetime', label: 'Target time' },
    { key: 'status', label: 'Status' },
  ]), []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Blood Requests</h1>
        <button className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <div className="bg-white rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {columns.map(c => (
                <th key={c.key} className="text-left px-3 py-2 font-medium text-gray-600">{c.label}</th>
              ))}
              <th className="px-3 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(r => (
              <tr key={r.id} className="border-t">
                {columns.map(c => (
                  <td key={c.key} className="px-3 py-2">{r[c.key] ?? ''}</td>
                ))}
                <td className="px-3 py-2 text-right space-x-2">
                  {r.status === 'pending' && (
                    <>
                      <button className="px-2 py-1 bg-green-600 text-white rounded disabled:opacity-50" disabled={busy[r.id]} onClick={() => act(r.id, 'accepted')}>Accept</button>
                      <button className="px-2 py-1 bg-amber-600 text-white rounded disabled:opacity-50" disabled={busy[r.id]} onClick={() => act(r.id, 'rejected')}>Reject</button>
                      <button className="px-2 py-1 bg-gray-200 rounded disabled:opacity-50" disabled={busy[r.id]} onClick={() => act(r.id, 'cancelled')}>Cancel</button>
                    </>
                  )}
                  {r.status === 'accepted' && (
                    <>
                      <button className="px-2 py-1 bg-sky-600 text-white rounded disabled:opacity-50" disabled={busy[r.id]} onClick={() => act(r.id, 'completed')}>Mark Completed</button>
                      <button className="px-2 py-1 bg-gray-200 rounded disabled:opacity-50" disabled={busy[r.id]} onClick={() => act(r.id, 'cancelled')}>Cancel</button>
                    </>
                  )}
                  {['rejected','cancelled','completed'].includes(r.status) && (
                    <span className="text-gray-500">—</span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-gray-500">No requests yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Cancel allowed by requester until 2 hours before target time. Accept decrements inventory on completion.</p>
    </div>
  );
}
