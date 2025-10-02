import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api';

export default function CrisisInvitations() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setLoading(true);
      const r = await api.crisisMyInvitations({ page_size: 20 });
      setItems(r.results || []);
    } catch (e) {
      setError(e.message || 'Failed to load invitations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function respond(inv, status) {
    try {
      await api.crisisInvitationRespond(inv.crisis_id, inv.id, status);
      await load();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Action failed' } }));
    }
  }

  if (loading) return <div>Loading invitations…</div>;
  if (error) return <div className="text-red-600">{error}</div>;

  return (
    <div className="bg-white p-6 rounded shadow">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Crisis Invitations</h2>
      </div>
      {!items.length ? (
        <div className="text-gray-600">No invitations right now.</div>
      ) : (
        <div className="divide-y">
          {items.map(inv => (
            <div key={inv.id} className="py-3 flex items-center justify-between">
              <div>
                <div className="font-medium">
                  <Link className="text-indigo-700 hover:underline" to={`/crises/${inv.crisis_id}`}>{inv.crisis_title || 'Crisis'}</Link>
                </div>
                <div className="text-sm text-gray-600">Type: {inv.org_type} • Status: {inv.status} • Incident: {inv.incident_type} / {inv.severity || 'n/a'}</div>
              </div>
              <div className="flex gap-2">
                <button disabled={inv.status==='accepted'} onClick={() => respond(inv, 'accepted')} className="px-3 py-1 text-xs rounded bg-emerald-50 text-emerald-700 border disabled:opacity-50">Accept</button>
                <button disabled={inv.status==='declined'} onClick={() => respond(inv, 'declined')} className="px-3 py-1 text-xs rounded bg-yellow-50 text-yellow-700 border disabled:opacity-50">Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
