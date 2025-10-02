import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function Campaigns() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [org, setOrg] = useState(null);
  const [list, setList] = useState([]);
  const [draft, setDraft] = useState({ title: '', campaign_type: 'cleanup', location_text: '', starts_at: '', ends_at: '' });
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const orgs = await api.request('/social/organizations/list');
        const list = orgs.results || [];
        const mine = list.find(o => o.user_id === me?.id) || list[0] || null;
        setOrg(mine);
      } catch {}
    })();
  }, [me?.id]);

  const load = async () => {
    try {
      const ownerId = me?.id ? String(me.id) : '';
      const r = await api.request(`/campaigns/list${ownerId ? `?owner=${ownerId}` : ''}`);
      setList(r.results || []);
    } catch {}
  };
  useEffect(() => { load(); }, []);

  const create = async (publish=false) => {
    if (!draft.title.trim()) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Title is required.' } }));
      return;
    }
    if (!draft.location_text.trim()) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Location (city) is required.' } }));
      return;
    }
    if (draft.starts_at && draft.ends_at) {
      const start = new Date(draft.starts_at).getTime();
      const end = new Date(draft.ends_at).getTime();
      if (!isNaN(start) && !isNaN(end) && end < start) {
        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'End time must be after start time.' } }));
        return;
      }
    }
    setBusy(true);
    try {
  // Only send fields guaranteed by all schemas; omit campaign_type if backend lacks the column
  const { title, description, location_text, starts_at, ends_at, target_metric, target_value } = draft;
  const body = { title, description, location_text, starts_at, ends_at };
  if (typeof target_metric !== 'undefined') body.target_metric = target_metric;
  if (typeof target_value !== 'undefined') body.target_value = target_value;
      const res = await api.request('/campaigns', 'POST', body);
      if (publish) {
        try { await api.request(`/campaigns/${res.id}/status`, 'POST', { status: 'active' }); } catch (e) {}
      }
      await load();
  setDraft({ title: '', campaign_type: 'cleanup', location_text: '', starts_at: '', ends_at: '' });
      nav(`/campaigns/${res.id}`);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Create failed' } }));
    } finally { setBusy(false); }
  };

  const owned = list.filter(c => c.owner_user_id === me?.id);
  const active = list.filter(c => c.status === 'active');

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="bg-white p-5 rounded-lg shadow md:col-span-1">
        <h2 className="text-xl font-semibold mb-3">Create Campaign</h2>
        <div className="space-y-2">
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} className="w-full border rounded px-3 py-2" placeholder="Title (e.g., Pond Cleaning)" />
          <input value={draft.location_text} onChange={e => setDraft({ ...draft, location_text: e.target.value })} className="w-full border rounded px-3 py-2" placeholder="Location (City name)" />
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" value={draft.starts_at} onChange={e => setDraft({ ...draft, starts_at: e.target.value })} className="border rounded px-3 py-2" />
            <input type="datetime-local" value={draft.ends_at} onChange={e => setDraft({ ...draft, ends_at: e.target.value })} className="border rounded px-3 py-2" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={busy} onClick={()=>create(false)} className="w-full py-2 bg-gray-100 rounded">Save as Draft</button>
            <button disabled={busy} onClick={()=>create(true)} className="w-full py-2 bg-indigo-600 text-white rounded">Create & Publish</button>
          </div>
        </div>
      </div>
      <div className="bg-white p-5 rounded-lg shadow md:col-span-2">
        <h3 className="text-lg font-semibold mb-2">Campaigns</h3>
        <div className="space-y-2">
          {list.length === 0 && <div className="text-gray-500">No campaigns yet.</div>}
          {list.map(c => (
            <div key={c.id} className="border rounded p-3 flex items-center justify-between">
              <div>
                <div className="font-semibold">{c.title}</div>
                <div className="text-xs text-gray-500">{c.location_text || '—'} | Status: {c.status}</div>
              </div>
              <button onClick={() => nav(`/campaigns/${c.id}`)} className="px-3 py-1 bg-purple-600 text-white rounded text-sm">Open</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
