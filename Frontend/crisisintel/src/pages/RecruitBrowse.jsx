import React, { useEffect, useState } from 'react';
import api from '../api';
import Button from '../components/ui/Button';

export default function RecruitBrowse() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [applyBusy, setApplyBusy] = useState({});
  const [drafts, setDrafts] = useState({}); // post_id -> { availability_at, notes }

  const load = async () => {
    setError(null); setLoading(true);
    try {
      const r = await api.listRecruitPosts({ status: 'active' });
      setPosts(r.results || []);
    } catch(e){ setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(()=>{ load(); }, []);

  const apply = async (post_id) => {
    setApplyBusy(b => ({...b, [post_id]: true}));
    try {
      const d = drafts[post_id] || {};
      await api.applyRecruitPost(post_id, { availability_at: d.availability_at || null, notes: d.notes || null });
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Applied' } }));
    } catch(e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Apply failed' } }));
    } finally { setApplyBusy(b => ({...b, [post_id]: false})); }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Donate Blood</h1>
      {error && <div className="mb-3 text-sm text-red-700">{String(error)}</div>}
      <div className="space-y-4">
        {posts.map(p => (
          <div key={p.id} className="bg-white rounded-lg shadow p-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="font-semibold">Post #{p.id} • Target: {p.target_blood_type || 'Any'}</div>
                <div className="text-sm text-gray-600">When: {p.scheduled_at || 'TBD'} • Where: {p.location_text || '—'}</div>
              </div>
            </div>
            {me && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                <input type="datetime-local" className="border rounded px-3 py-2" value={(drafts[p.id]?.availability_at) || ''} onChange={e=>setDrafts(d => ({...d, [p.id]: {...(d[p.id]||{}), availability_at: e.target.value }}))} />
                <input className="border rounded px-3 py-2" placeholder="Notes (optional)" value={(drafts[p.id]?.notes) || ''} onChange={e=>setDrafts(d => ({...d, [p.id]: {...(d[p.id]||{}), notes: e.target.value }}))} />
                <div className="flex justify-end md:justify-start"><Button onClick={()=>apply(p.id)} disabled={!!applyBusy[p.id]}>Apply</Button></div>
              </div>
            )}
          </div>
        ))}
        {posts.length === 0 && !loading && <div className="text-gray-600">No active recruit posts.</div>}
      </div>
    </div>
  );
}
