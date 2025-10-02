import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

export default function MyCampaigns() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const [owned, joined] = await Promise.all([
          api.myCampaigns().catch(()=>({results:[]})),
          api.myCampaignParticipations().catch(()=>({results:[]})),
        ]);
        if (!cancelled) {
          const ownList = owned.results || owned.items || [];
          const joinList = joined.results || joined.items || [];
          // De-duplicate by id, prefer joined record (has participation_status)
          const map = new Map();
          for (const c of ownList) map.set(String(c.id), c);
          for (const c of joinList) map.set(String(c.id), { ...map.get(String(c.id)), ...c });
          setItems(Array.from(map.values()));
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load campaigns');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => {
    const current = [];
    const past = [];
    for (const c of items) {
      const st = (c.status || c.campaign_status || '').toLowerCase();
      if (st === 'active' || st === 'draft') current.push(c);
      else past.push(c);
    }
    return { current, past };
  }, [items]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My Campaigns</h1>
        <button className="px-3 py-1.5 text-sm bg-gray-100 rounded" onClick={async()=>{
          try { const r = await api.myCampaignParticipations(); setItems(r.results || r.items || []); } catch {}
        }}>Refresh</button>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}

      <section>
        <h2 className="font-medium mb-2">Current</h2>
        <div className="divide-y bg-white border rounded">
          {groups.current.length === 0 && <div className="p-3 text-sm text-gray-500">No current campaigns.</div>}
          {groups.current.map(c => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="flex items-center justify-between p-3 hover:bg-gray-50">
              <div>
                <div className="font-medium">{c.title}</div>
                <div className="text-xs text-gray-500">Status: {c.status}</div>
                {c.role_label && <div className="text-xs text-gray-500">Role: {c.role_label}</div>}
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border">{c.participation_status || 'accepted'}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="font-medium mb-2">Past</h2>
        <div className="divide-y bg-white border rounded">
          {groups.past.length === 0 && <div className="p-3 text-sm text-gray-500">No past campaigns.</div>}
          {groups.past.map(c => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="flex items-center justify-between p-3 hover:bg-gray-50">
              <div>
                <div className="font-medium">{c.title}</div>
                <div className="text-xs text-gray-500">Status: {c.status}</div>
                {c.role_label && <div className="text-xs text-gray-500">Role: {c.role_label}</div>}
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 border">{c.participation_status || 'accepted'}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
