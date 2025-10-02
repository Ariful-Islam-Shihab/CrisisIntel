import React, { useEffect, useState } from 'react';
import api from '../api';
import Button from '../components/ui/Button';

const BLOOD_TYPES = ['A+','A-','B+','B-','O+','O-','AB+','AB-'];

export default function BloodBankDonors() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const isBloodBank = typeof me?.role === 'string' && me.role.toLowerCase().includes('blood');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [donors, setDonors] = useState([]);
  const [busy, setBusy] = useState({});
  const [editing, setEditing] = useState({}); // donor_id -> { blood_type, notes }
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [newDonor, setNewDonor] = useState({ user_id: '', blood_type: '', notes: '' });

  const load = async () => {
    setError(null); setLoading(true);
    try {
      const r = await api.bloodBankDonorsList();
      setDonors(r.results || r.items || []);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const findUsers = async (q) => {
    setSearch(q);
    if (!q || q.length < 2) { setResults([]); return; }
    try {
      const r = await api.searchUsers(q);
      setResults(r.results || r.items || r || []);
    } catch (e) {
      // ignore
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (!newDonor.user_id || !newDonor.blood_type) return;
    setBusy(b => ({...b, add:true})); setError(null);
    try {
      await api.bloodBankDonorsAdd({ user_id: Number(newDonor.user_id), blood_type: newDonor.blood_type, notes: newDonor.notes || null });
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Donor added' } }));
      setNewDonor({ user_id: '', blood_type: '', notes: '' }); setResults([]); setSearch('');
      await load();
    } catch (e) {
      setError(e.message || 'Add failed');
    } finally { setBusy(b => ({...b, add:false})); }
  };

  const update = async (id, patch) => {
    setBusy(b => ({...b, [id]: true})); setError(null);
    try {
      await api.bloodBankDonorsUpdate(id, patch);
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Saved' } }));
      await load();
    } catch (e) {
      setError(e.message || 'Update failed');
    } finally { setBusy(b => ({...b, [id]: false})); }
  };

  const removeItem = async (id) => {
    if (!window.confirm('Remove this donor from our list?')) return;
    setBusy(b => ({...b, [id]: true})); setError(null);
    try {
      await api.bloodBankDonorsRemove(id);
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Removed' } }));
      setDonors(s => s.filter(x => x.id !== id));
    } catch (e) {
      setError(e.message || 'Remove failed');
    } finally { setBusy(b => ({...b, [id]: false})); }
  };

  if (!isBloodBank) {
    return <div className="max-w-3xl mx-auto"><h2 className="text-xl font-semibold">Forbidden</h2><p>You must be a blood bank user to access this page.</p></div>;
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Our Donors</h1>
      {error && <div className="mb-3 text-sm text-red-700">{String(error)}</div>}

      <form onSubmit={add} className="p-4 bg-white rounded-lg shadow mb-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="col-span-2 relative">
            <input className="border rounded px-3 py-2 w-full" placeholder="Search users by name or email" value={search} onChange={e=>findUsers(e.target.value)} />
            {results.length > 0 && (
              <div className="absolute z-10 bg-white border rounded w-full max-h-48 overflow-auto">
                {results.map(u => (
                  <div key={u.id} className="px-3 py-2 hover:bg-gray-50 cursor-pointer" onClick={()=>{ setNewDonor(d => ({...d, user_id: u.id})); setSearch(`${u.full_name || u.email} (#${u.id})`); setResults([]); }}>
                    {u.full_name || u.email} <span className="text-xs text-gray-500">#{u.id}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <select className="border rounded px-3 py-2" value={newDonor.blood_type} onChange={e=>setNewDonor({...newDonor, blood_type: e.target.value})} required>
            <option value="">Blood Type</option>
            {BLOOD_TYPES.map(bt => <option key={bt} value={bt}>{bt}</option>)}
          </select>
          <input className="border rounded px-3 py-2" placeholder="Notes (optional)" value={newDonor.notes} onChange={e=>setNewDonor({...newDonor, notes: e.target.value})} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={!!busy.add || !newDonor.user_id || !newDonor.blood_type}>Add Donor</Button>
        </div>
      </form>

      <div className="bg-white rounded-lg shadow">
        <table className="min-w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left p-3">User</th>
              <th className="text-left p-3">Blood Type</th>
              <th className="text-left p-3">Notes</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(donors || []).map(d => (
              <tr key={d.id} className="border-t">
                <td className="p-3">
                  <a href={`/users/${d.user_id}`} className="text-indigo-600 hover:underline">{d.user_full_name || d.user_email || `#${d.user_id}`}</a>
                </td>
                <td className="p-3">
                  {editing[d.id] ? (
                    <select
                      className="border rounded px-2 py-1"
                      value={editing[d.id].blood_type}
                      onChange={e=>setEditing(ed => ({...ed, [d.id]: {...ed[d.id], blood_type: e.target.value}}))}
                      disabled={!!busy[d.id]}
                    >
                      {BLOOD_TYPES.map(bt => <option key={bt} value={bt}>{bt}</option>)}
                    </select>
                  ) : (
                    <span className="inline-block px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm">{d.blood_type || '—'}</span>
                  )}
                </td>
                <td className="p-3">
                  {editing[d.id] ? (
                    <input
                      className="border rounded px-2 py-1 w-full"
                      value={editing[d.id].notes || ''}
                      onChange={e=>setEditing(ed => ({...ed, [d.id]: {...ed[d.id], notes: e.target.value}}))}
                      disabled={!!busy[d.id]}
                    />
                  ) : (
                    <div className="text-gray-800">{d.notes ? d.notes : <span className="text-gray-400">—</span>}</div>
                  )}
                </td>
                <td className="p-3 text-right space-x-2">
                  {editing[d.id] ? (
                    <>
                      <Button
                        onClick={async ()=>{
                          const payload = { blood_type: editing[d.id].blood_type, notes: editing[d.id].notes };
                          await update(d.id, payload);
                          setEditing(ed => { const n = {...ed}; delete n[d.id]; return n; });
                        }}
                        disabled={!!busy[d.id]}
                      >Save</Button>
                      <button
                        className="px-3 py-1 border rounded text-gray-700 hover:bg-gray-50"
                        onClick={(e)=>{ e.preventDefault(); setEditing(ed => { const n={...ed}; delete n[d.id]; return n; }); }}
                        disabled={!!busy[d.id]}
                      >Cancel</button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        onClick={()=> setEditing(ed => ({...ed, [d.id]: { blood_type: d.blood_type || '', notes: d.notes || '' }}))}
                        disabled={!!busy[d.id]}
                      >Edit</Button>
                      <Button variant="danger" onClick={()=>removeItem(d.id)} disabled={!!busy[d.id]}>Remove</Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {(!donors || donors.length === 0) && (
              <tr><td className="p-4 text-gray-500" colSpan={4}>{loading ? 'Loading...' : 'No donors yet.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
