import React, { useEffect, useState } from 'react';
import api from '../api';
import Button from '../components/ui/Button';

export default function RecruitManage() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const isBloodBank = typeof me?.role === 'string' && me.role.toLowerCase().includes('blood');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({ target_blood_type:'', location_text:'', scheduled_at:'', notes:'' });
  const [apps, setApps] = useState({}); // post_id -> applications
  const [filters, setFilters] = useState({}); // post_id -> {status:'', blood_type:''}
  const [appsLoading, setAppsLoading] = useState({});
  const [editing, setEditing] = useState({}); // post_id -> draft
  const [appsOpen, setAppsOpen] = useState({}); // post_id -> boolean

  const toInputDateTime = (val) => {
    if (!val) return '';
    const s = String(val).replace(' ', 'T');
    return s.slice(0, 16);
  };

  const load = async () => {
    setError(null); setLoading(true);
    try {
      const r = await api.listRecruitPosts({});
      // Filter to my bank's posts (owner is current user)
      const mine = (r.results || []).filter(p => p.owner_user_id === me?.id);
      setPosts(mine);
    } catch (e) { setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(()=>{ load(); }, []);

  const create = async (e) => {
    e.preventDefault();
    try {
      await api.createRecruitPost(draft);
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Recruit post created' } }));
      setDraft({ target_blood_type:'', location_text:'', scheduled_at:'', notes:'' });
      await load();
    } catch(e) { setError(e.message || 'Create failed'); }
  };

  const loadApps = async (post_id) => {
    setAppsLoading(a => ({...a, [post_id]: true}));
    try {
      const r = await api.listRecruitApplications(post_id);
      setApps(m => ({...m, [post_id]: r.results || []}));
    } catch(e) { /* noop */ }
    finally { setAppsLoading(a => ({...a, [post_id]: false})); }
  };

  const setAppStatus = async (app_id, status, post_id) => {
    try {
      await api.updateApplicationStatus(app_id, status);
      if (status === 'accepted') {
        window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Accepted and added as donor' } }));
      }
      await loadApps(post_id);
    } catch (e) { window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Update failed' } })); }
  };

  if (!isBloodBank) return <div className="max-w-3xl mx-auto">Forbidden</div>;

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Recruitment Posts</h1>
      {error && <div className="mb-3 text-sm text-red-700">{String(error)}</div>}

      <form onSubmit={create} className="p-4 bg-white rounded-lg shadow mb-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select className="border rounded px-3 py-2" value={draft.target_blood_type} onChange={e=>setDraft(d=>({...d, target_blood_type:e.target.value}))}>
            <option value="">Target Blood Type (optional)</option>
            {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bt => <option key={bt} value={bt}>{bt}</option>)}
          </select>
          <input className="border rounded px-3 py-2" placeholder="Location" value={draft.location_text} onChange={e=>setDraft(d=>({...d, location_text:e.target.value}))} />
          <input type="datetime-local" className="border rounded px-3 py-2" placeholder="Deadline" value={draft.scheduled_at} onChange={e=>setDraft(d=>({...d, scheduled_at:e.target.value}))} />
          <input className="border rounded px-3 py-2" placeholder="Notes" value={draft.notes} onChange={e=>setDraft(d=>({...d, notes:e.target.value}))} />
        </div>
        <div className="flex justify-end"><Button type="submit">Create Post</Button></div>
      </form>

      <div className="space-y-4">
        {posts.map(p => (
          <div key={p.id} className="bg-white rounded-lg shadow p-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="font-semibold">Post #{p.id}</div>
                {!editing[p.id] && (
                  <div className="text-sm text-gray-600">Target: {p.target_blood_type || 'Any'} • Deadline: {p.scheduled_at || 'TBD'} • Where: {p.location_text || '—'}</div>
                )}
              </div>
              <div className="space-x-2">
                {!editing[p.id] && (
                  <>
                    <Button variant="secondary" onClick={()=>loadApps(p.id)} disabled={!!appsLoading[p.id]}>View Applications</Button>
                    <Button onClick={()=>setEditing(e=>({
                      ...e,
                      [p.id]: {
                        target_blood_type: p.target_blood_type || '',
                        location_text: p.location_text || '',
                        scheduled_at: toInputDateTime(p.scheduled_at),
                        notes: p.notes || ''
                      }
                    }))}>Edit</Button>
                    {p.status !== 'closed' ? (
                      <Button variant="danger" onClick={async ()=>{ try{await api.closeRecruitPost(p.id); await load();} catch(e){}}}>Close</Button>
                    ) : (
                      <Button onClick={async ()=>{ try{await api.updateRecruitPost(p.id, { status: 'active' }); await load(); } catch(e){}}}>Reopen</Button>
                    )}
                    <Button variant="danger" onClick={async ()=>{
                      const ok = window.confirm('Delete this recruit post? This will remove its applications.');
                      if (!ok) return;
                      try { await api.deleteRecruitPost(p.id); window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Post deleted' } })); await load(); }
                      catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Delete failed' } })); }
                    }}>Delete</Button>
                  </>
                )}
              </div>
            </div>
            {editing[p.id] && (
              <div className="mt-3 p-3 border rounded bg-gray-50">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
                  <select className="border rounded px-3 py-2" value={editing[p.id].target_blood_type} onChange={e=>setEditing(ed=>({...ed, [p.id]: {...ed[p.id], target_blood_type: e.target.value}}))}>
                    <option value="">Target Blood Type (optional)</option>
                    {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bt => <option key={bt} value={bt}>{bt}</option>)}
                  </select>
                  <input className="border rounded px-3 py-2" placeholder="Location" value={editing[p.id].location_text} onChange={e=>setEditing(ed=>({...ed, [p.id]: {...ed[p.id], location_text: e.target.value}}))} />
                  <input type="datetime-local" className="border rounded px-3 py-2" placeholder="Deadline" value={editing[p.id].scheduled_at} onChange={e=>setEditing(ed=>({...ed, [p.id]: {...ed[p.id], scheduled_at: e.target.value}}))} />
                  <input className="border rounded px-3 py-2" placeholder="Notes" value={editing[p.id].notes} onChange={e=>setEditing(ed=>({...ed, [p.id]: {...ed[p.id], notes: e.target.value}}))} />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button onClick={async ()=>{
                    const patch = { ...editing[p.id] };
                    try { await api.updateRecruitPost(p.id, patch); window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Post updated' } })); setEditing(ed=>{ const n={...ed}; delete n[p.id]; return n; }); await load(); }
                    catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Update failed' } })); }
                  }}>Save</Button>
                  <Button variant="secondary" onClick={()=>setEditing(ed=>{ const n={...ed}; delete n[p.id]; return n; })}>Cancel</Button>
                </div>
              </div>
            )}
            {Array.isArray(apps[p.id]) && (
              <div className="mt-4 border-t pt-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">Applications</h3>
                    <span className="text-xs bg-gray-100 border border-gray-200 rounded px-2 py-0.5">{apps[p.id].length}</span>
                    <button className="text-xs text-purple-700 underline" onClick={()=>setAppsOpen(o=>({...o, [p.id]: !o[p.id]}))}>{appsOpen[p.id] ? 'Collapse' : 'Expand'}</button>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <select className="border rounded px-2 py-1" value={(filters[p.id]?.status)||''} onChange={e=>setFilters(f=>({...f, [p.id]: {...f[p.id], status: e.target.value}}))}>
                      <option value="">All statuses</option>
                      {['pending','accepted','rejected','attended'].map(s=>(<option key={s} value={s}>{s}</option>))}
                    </select>
                    <select className="border rounded px-2 py-1" value={(filters[p.id]?.blood_type)||''} onChange={e=>setFilters(f=>({...f, [p.id]: {...f[p.id], blood_type: e.target.value}}))}>
                      <option value="">All blood types</option>
                      {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bt=>(<option key={bt} value={bt}>{bt}</option>))}
                    </select>
                  </div>
                </div>
                {appsOpen[p.id] && (
                <ul className="space-y-2">
                  {apps[p.id]
                    .filter(a => !filters[p.id]?.status || a.status === filters[p.id]?.status)
                    .filter(a => !filters[p.id]?.blood_type || (a.donor_blood_type || '').toUpperCase() === filters[p.id]?.blood_type)
                    .map(a => (
                      <li key={a.id} className="flex items-center justify-between">
                        <div className="text-sm">
                          <span className="font-medium">{a.donor_full_name || `User #${a.donor_user_id}`}</span>
                          {a.donor_blood_type ? <span className="ml-2 inline-block px-2 py-0.5 text-xs rounded bg-red-50 border border-red-200">{a.donor_blood_type}</span> : null}
                          <span className="ml-2">• Availability: {a.availability_at || '—'}</span>
                          <span className="ml-2">• Status: <span className="font-medium">{a.status}</span></span>
                        </div>
                        <div className="space-x-2">
                          <Button onClick={()=>setAppStatus(a.id, 'accepted', p.id)} disabled={a.status==='accepted'}>Accept</Button>
                          <Button variant="secondary" onClick={()=>setAppStatus(a.id, 'rejected', p.id)} disabled={a.status==='rejected'}>Reject</Button>
                        </div>
                      </li>
                    ))}
                  {apps[p.id].length === 0 && <li className="text-sm text-gray-500">No applications yet.</li>}
                </ul>
                )}
              </div>
            )}
          </div>
        ))}
        {posts.length === 0 && !loading && <div className="text-gray-600">No posts yet.</div>}
      </div>
    </div>
  );
}
