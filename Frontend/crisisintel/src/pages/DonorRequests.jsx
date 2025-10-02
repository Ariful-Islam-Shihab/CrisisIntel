import React, { useEffect, useState } from 'react';
import api from '../api';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { formatDateTime, fromNow, statusVariant } from '../utils/datetime';

export default function DonorRequests() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({});
  const [cooldownDraft, setCooldownDraft] = useState({}); // id -> days (defaults to 10)
  const [availability, setAvailability] = useState({ status: 'available', cooldown_until: null });
  const [availDays, setAvailDays] = useState(10);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.listDonorMeetingRequests({ donor_user_id: me?.id });
      setItems(r.results || r.items || []);
      // Load current profile availability
      try {
        const p = await api.myDonorProfile();
        const prof = p?.profile || null;
        const status = prof?.availability_status || (prof?.cooldown_until ? 'cooldown' : 'available');
        setAvailability({ status, cooldown_until: prof?.cooldown_until || null });
      } catch {}
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const act = async (id, status, extra={}) => {
    setBusy(x => ({ ...x, [id]: true }));
    try {
      await api.updateDonorMeetingRequestStatus(id, status, extra);
      await load();
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: `Request ${status}` } }));
    } catch (e) {
      const msg = String(e.message||'').toLowerCase();
      let friendly = null;
      if (msg.includes('too_late_to_cancel')) friendly = 'Too late to cancel (within 2 hours).';
      if (msg.includes('cooldown_active')) friendly = 'Cooldown active; cannot accept the scheduled time.';
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: friendly || (e.message || 'Action failed') } }));
    } finally {
      setBusy(x => { const y = { ...x }; delete y[id]; return y; });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Donor Requests</h1>
        <button className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm" onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {/* Availability panel */}
      <div className="bg-white border rounded-lg p-3 flex items-center justify-between">
        <div className="text-sm text-gray-700">
          <span className="font-medium">Availability:</span>{' '}
          {availability.status === 'cooldown' ? (
            <>
              <span className="text-red-600">Cooldown</span>
              {availability.cooldown_until && (
                <span className="text-gray-500"> until {new Date(availability.cooldown_until).toLocaleString()}</span>
              )}
            </>
          ) : (
            <span className="text-green-700">Available</span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <input type="number" min={0} className="w-28 border rounded px-2 py-1 text-sm" value={availDays} onChange={e=>setAvailDays(Number(e.target.value||10))} />
          <span className="text-xs text-gray-500">days</span>
          <Button size="sm" variant="success" onClick={async ()=>{
            try {
              await api.setDonorAvailability('available');
              window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Set to Available' } }));
              await load();
            } catch (e) {
              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed' } }));
            }
          }}>Set Available</Button>
          <Button size="sm" variant="warning" onClick={async ()=>{
            try {
              await api.setDonorAvailability('cooldown', availDays);
              window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: `Cooldown for ${availDays} days` } }));
              await load();
            } catch (e) {
              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed' } }));
            }
          }}>Set Cooldown</Button>
        </div>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      <div className="bg-white rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-600">ID</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Requester</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Blood</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">When</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Location</th>
              <th className="text-left px-3 py-2 font-medium text-gray-600">Status</th>
              <th className="px-3 py-2 text-right font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map(r => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2">{r.id}</td>
                <td className="px-3 py-2">{r.requester_name}</td>
                <td className="px-3 py-2">{r.blood_type || '—'}</td>
                <td className="px-3 py-2">{r.target_datetime ? `${formatDateTime(r.target_datetime)} (${fromNow(r.target_datetime)})` : '—'}</td>
                <td className="px-3 py-2">{r.location_text || '—'}</td>
                <td className="px-3 py-2"><Badge variant={statusVariant(r.status)}>{r.status.replace('_',' ')}</Badge></td>
                <td className="px-3 py-2 text-right space-x-2">
                  {r.status === 'pending' && (
                    <>
                      <Button className="mr-2" size="sm" variant="success" disabled={busy[r.id]} onClick={() => act(r.id, 'accepted')}>Accept</Button>
                      <Button size="sm" variant="warning" disabled={busy[r.id]} onClick={() => act(r.id, 'rejected')}>Reject</Button>
                    </>
                  )}
                  {r.status === 'accepted' && (
                    <div className="inline-flex items-center space-x-2">
                      <label className="text-xs text-gray-600">Cooldown (days):</label>
                      <input type="number" min={0} className="w-24 border rounded px-2 py-1" placeholder="default 10" value={cooldownDraft[r.id] ?? 10} onChange={e=>setCooldownDraft(d=>({...d, [r.id]: e.target.value}))} />
                      <Button size="sm" variant="info" disabled={busy[r.id]} onClick={() => {
                        const val = cooldownDraft[r.id];
                        const days = (val === undefined || val === null || String(val).trim()==='') ? 10 : Number(val);
                        act(r.id, 'completed', { cooldown_days: days });
                      }}>Complete</Button>
                      <Button size="sm" variant="outline" disabled={busy[r.id]} onClick={() => act(r.id, 'cancelled')}>Cancel</Button>
                    </div>
                  )}
                  {['rejected','cancelled','completed'].includes(r.status) && (
                    <span className="text-gray-500">—</span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">No requests.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">Cancel allowed by either side until 2 hours before. Completion can set cooldown days to block earlier future donations. You can also set your overall availability or a manual cooldown above.</p>
    </div>
  );
}
