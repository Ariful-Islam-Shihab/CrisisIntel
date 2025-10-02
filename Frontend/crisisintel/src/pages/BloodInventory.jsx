import React, { useEffect, useState } from 'react';
import api from '../api';
import Button from '../components/ui/Button';

const BLOOD_TYPES = ['A+','A-','B+','B-','O+','O-','AB+','AB-'];

export default function BloodInventory() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const isBloodBank = typeof me?.role === 'string' && me.role.toLowerCase().includes('blood');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState({});
  const [editing, setEditing] = useState({}); // blood_type -> true
  const [draft, setDraft] = useState({});     // blood_type -> quantity (string/number)
  const [issueFor, setIssueFor] = useState(null); // { blood_type }
  const [issueForm, setIssueForm] = useState({ blood_type: '', quantity_units: '', purpose: '', issued_to_name: '', issued_to_contact: '' });
  const [issuances, setIssuances] = useState([]);
  const [issEditing, setIssEditing] = useState({}); // id -> { purpose, issued_to_name, issued_to_contact }

  const load = async () => {
    setError(null); setLoading(true);
    try {
      const r = await api.bloodInventoryList();
      setItems(r.results || r.items || []);
      // Also load recent issuances
      const ir = await api.bloodInventoryIssuancesList().catch(() => ({ results: [] }));
      setIssuances(ir.results || ir.items || []);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const saveQty = async (blood_type) => {
    const quantity_units = Number(draft[blood_type] ?? 0);
    setBusy(b => ({...b, [blood_type]: true})); setError(null);
    try {
      await api.bloodInventorySet(blood_type, quantity_units);
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Saved' } }));
      setEditing(ed => { const n={...ed}; delete n[blood_type]; return n; });
      setDraft(d => { const n={...d}; delete n[blood_type]; return n; });
      await load();
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally { setBusy(b => ({...b, [blood_type]: false})); }
  };

  const openIssue = (bt) => {
    setIssueFor({ blood_type: bt });
    setIssueForm({ blood_type: bt, quantity_units: '', purpose: '', issued_to_name: '', issued_to_contact: '' });
  };
  const submitIssue = async (e) => {
    e.preventDefault();
    const bt = issueForm.blood_type;
    const qty = Number(issueForm.quantity_units || 0);
    if (!bt || !qty || qty <= 0 || isNaN(qty)) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Enter a valid quantity to issue.' } }));
      return;
    }
    setBusy(b => ({ ...b, issue: true })); setError(null);
    try {
      await api.bloodInventoryIssue(bt, qty, { purpose: issueForm.purpose || null, issued_to_name: issueForm.issued_to_name || null, issued_to_contact: issueForm.issued_to_contact || null });
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Issued from inventory' } }));
      setIssueFor(null);
      await load();
    } catch (e) {
      setError(e.message || 'Issue failed');
    } finally {
      setBusy(b => ({ ...b, issue: false }));
    }
  };
  const revertIssuance = async (id) => {
    setBusy(b => ({ ...b, [`iss-${id}`]: true }));
    try {
      await api.bloodInventoryIssuanceUpdate(id, { status: 'reverted' });
      await load();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Revert failed' } }));
    } finally {
      setBusy(b => { const n={...b}; delete n[`iss-${id}`]; return n; });
    }
  };
  const deleteIssuance = async (id) => {
    if (!window.confirm('Delete this issuance record? Inventory will be restored if not already reverted.')) return;
    setBusy(b => ({ ...b, [`iss-${id}`]: true }));
    try {
      await api.bloodInventoryIssuanceDelete(id);
      await load();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Delete failed' } }));
    } finally {
      setBusy(b => { const n={...b}; delete n[`iss-${id}`]; return n; });
    }
  };
  const saveIssuance = async (id) => {
    const patch = issEditing[id];
    if (!patch) return;
    setBusy(b => ({ ...b, [`iss-${id}`]: true }));
    try {
      await api.bloodInventoryIssuanceUpdate(id, {
        purpose: patch.purpose || null,
        issued_to_name: patch.issued_to_name || null,
        issued_to_contact: patch.issued_to_contact || null,
      });
      setIssEditing(ed => { const n={...ed}; delete n[id]; return n; });
      await load();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Save failed' } }));
    } finally {
      setBusy(b => { const n={...b}; delete n[`iss-${id}`]; return n; });
    }
  };

  if (!isBloodBank) {
    return <div className="max-w-3xl mx-auto"><h2 className="text-xl font-semibold">Forbidden</h2><p>You must be a blood bank user to access this page.</p></div>;
  }

  const map = new Map((items || []).map(i => [i.blood_type, i]));

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Inventory</h1>
      {error && <div className="mb-3 text-sm text-red-700">{String(error)}</div>}

      <div className="bg-white rounded-lg shadow divide-y">
        {BLOOD_TYPES.map(bt => {
          const row = map.get(bt) || { blood_type: bt, quantity_units: 0 };
          return (
            <div key={bt} className="flex items-center justify-between p-3">
              <div>
                <div className="font-medium">{bt}</div>
                <div className="text-xs text-gray-500">Last updated: {row.updated_at ? new Date(row.updated_at).toLocaleString() : '—'}</div>
              </div>
              <div className="flex items-center space-x-2">
                {editing[bt] ? (
                  <>
                    <input
                      type="number"
                      className="border rounded px-2 py-1 w-24"
                      min={0}
                      value={draft[bt] ?? (row.quantity_units || 0)}
                      onChange={e=> setDraft(d => ({...d, [bt]: e.target.value}))}
                      disabled={!!busy[bt]}
                    />
                    <Button onClick={()=>saveQty(bt)} disabled={!!busy[bt]}>Save</Button>
                    <button
                      className="px-3 py-1 border rounded text-gray-700 hover:bg-gray-50"
                      onClick={(e)=>{ e.preventDefault(); setEditing(ed => { const n={...ed}; delete n[bt]; return n; }); setDraft(d => { const n={...d}; delete n[bt]; return n; }); }}
                      disabled={!!busy[bt]}
                    >Cancel</button>
                  </>
                ) : (
                  <>
                    <span className="inline-block px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm">{row.quantity_units ?? 0}</span>
                    <Button variant="secondary" onClick={()=>{ setEditing(ed => ({...ed, [bt]: true})); setDraft(d => ({...d, [bt]: row.quantity_units ?? 0})); }} disabled={!!busy[bt]}>Edit</Button>
                    <Button onClick={()=>openIssue(bt)} disabled={!!busy[bt] || (row.quantity_units || 0) <= 0}>Issue</Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Issue Drawer */}
      {issueFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white w-full max-w-md rounded-lg shadow-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold">Issue {issueForm.blood_type} Units</h3>
              <button className="text-gray-500 hover:text-gray-800" onClick={()=>setIssueFor(null)}>✕</button>
            </div>
            <form onSubmit={submitIssue} className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Quantity</label>
                <input type="number" min={1} className="w-full border rounded px-3 py-2" value={issueForm.quantity_units} onChange={e=>setIssueForm(f=>({...f, quantity_units: e.target.value}))} />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Purpose (optional)</label>
                <input className="w-full border rounded px-3 py-2" value={issueForm.purpose} onChange={e=>setIssueForm(f=>({...f, purpose: e.target.value}))} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Issued To (name)</label>
                  <input className="w-full border rounded px-3 py-2" value={issueForm.issued_to_name} onChange={e=>setIssueForm(f=>({...f, issued_to_name: e.target.value}))} />
                </div>
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Contact</label>
                  <input className="w-full border rounded px-3 py-2" value={issueForm.issued_to_contact} onChange={e=>setIssueForm(f=>({...f, issued_to_contact: e.target.value}))} />
                </div>
              </div>
              <div className="flex justify-end space-x-2 pt-2">
                <button type="button" className="px-3 py-1.5 border rounded" onClick={()=>setIssueFor(null)} disabled={!!busy.issue}>Cancel</button>
                <Button type="submit" loading={!!busy.issue}>Issue</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issuances History */}
      <div className="mt-6">
        <h2 className="text-lg font-semibold mb-2">Recent Issuances</h2>
        <div className="bg-white rounded-lg shadow overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-3 py-2">Time</th>
                <th className="text-left px-3 py-2">Blood</th>
                <th className="text-left px-3 py-2">Units</th>
                <th className="text-left px-3 py-2">Purpose</th>
                <th className="text-left px-3 py-2">Issued To</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(issuances || []).map(x => (
                <tr key={x.id} className="border-t">
                  <td className="px-3 py-2">{x.created_at ? new Date(x.created_at).toLocaleString() : '—'}</td>
                  <td className="px-3 py-2">{x.blood_type}</td>
                  <td className="px-3 py-2">{x.quantity_units}</td>
                  <td className="px-3 py-2">
                    {issEditing[x.id] ? (
                      <input className="border rounded px-2 py-1 w-full" value={issEditing[x.id].purpose} onChange={e=>setIssEditing(ed=>({...ed, [x.id]: {...ed[x.id], purpose: e.target.value}}))} />
                    ) : (x.purpose || '—')}
                  </td>
                  <td className="px-3 py-2">
                    {issEditing[x.id] ? (
                      <div className="grid grid-cols-2 gap-2">
                        <input className="border rounded px-2 py-1" placeholder="Name" value={issEditing[x.id].issued_to_name} onChange={e=>setIssEditing(ed=>({...ed, [x.id]: {...ed[x.id], issued_to_name: e.target.value}}))} />
                        <input className="border rounded px-2 py-1" placeholder="Contact" value={issEditing[x.id].issued_to_contact} onChange={e=>setIssEditing(ed=>({...ed, [x.id]: {...ed[x.id], issued_to_contact: e.target.value}}))} />
                      </div>
                    ) : (
                      <span>{x.issued_to_name || '—'}{x.issued_to_contact ? ` (${x.issued_to_contact})` : ''}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{x.status}</td>
                  <td className="px-3 py-2 text-right space-x-2">
                    {issEditing[x.id] ? (
                      <>
                        <Button onClick={()=>saveIssuance(x.id)} disabled={!!busy[`iss-${x.id}`]}>Save</Button>
                        <button className="px-3 py-1 border rounded" onClick={()=>setIssEditing(ed=>{ const n={...ed}; delete n[x.id]; return n; })} disabled={!!busy[`iss-${x.id}`]}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <Button variant="secondary" onClick={()=>setIssEditing(ed=>({...ed, [x.id]: { purpose: x.purpose || '', issued_to_name: x.issued_to_name || '', issued_to_contact: x.issued_to_contact || '' }}))} disabled={!!busy[`iss-${x.id}`]}>Edit</Button>
                        {x.status === 'issued' && (
                          <Button variant="secondary" onClick={()=>revertIssuance(x.id)} disabled={!!busy[`iss-${x.id}`]}>Revert</Button>
                        )}
                        <Button variant="danger" onClick={()=>deleteIssuance(x.id)} disabled={!!busy[`iss-${x.id}`]}>Delete</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {(issuances || []).length === 0 && (
                <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-500">No issuances yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
