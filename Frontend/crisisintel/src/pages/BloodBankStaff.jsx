import React, { useEffect, useState } from 'react';
import api from '../api';
import Button from '../components/ui/Button';

export default function BloodBankStaff() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const isBloodBank = typeof me?.role === 'string' && me.role.toLowerCase().includes('blood');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [staff, setStaff] = useState([]);
  const [busy, setBusy] = useState({});
  const [newStaff, setNewStaff] = useState({ name: '', role: '', phone: '', email: '' });

  const load = async () => {
    setError(null); setLoading(true);
    try {
      const r = await api.bloodBankStaffList();
      setStaff(r.results || r.items || []);
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const add = async (e) => {
    e.preventDefault();
    setBusy(b => ({...b, add:true})); setError(null);
    try {
      const r = await api.bloodBankStaffAdd(newStaff);
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Added' } }));
      setNewStaff({ name: '', role: '', phone: '', email: '' });
      await load();
    } catch (e) {
      setError(e.message || 'Add failed');
    } finally { setBusy(b => ({...b, add:false})); }
  };

  const update = async (id, patch) => {
    setBusy(b => ({...b, [id]: true})); setError(null);
    try {
      await api.bloodBankStaffUpdate(id, patch);
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Saved' } }));
      await load();
    } catch (e) {
      setError(e.message || 'Update failed');
    } finally { setBusy(b => ({...b, [id]: false})); }
  };

  const removeItem = async (id) => {
    if (!window.confirm('Remove this staff member?')) return;
    setBusy(b => ({...b, [id]: true})); setError(null);
    try {
      await api.bloodBankStaffRemove(id);
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Removed' } }));
      setStaff(s => s.filter(x => x.id !== id));
    } catch (e) {
      setError(e.message || 'Remove failed');
    } finally { setBusy(b => ({...b, [id]: false})); }
  };

  if (!isBloodBank) {
    return <div className="max-w-3xl mx-auto"><h2 className="text-xl font-semibold">Forbidden</h2><p>You must be a blood bank user to access this page.</p></div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">My Staffs</h1>
      {error && <div className="mb-3 text-sm text-red-700">{String(error)}</div>}

      <form onSubmit={add} className="p-4 bg-white rounded-lg shadow mb-6 space-y-2">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className="border rounded px-3 py-2" placeholder="Name" value={newStaff.name} onChange={e=>setNewStaff({...newStaff, name:e.target.value})} required />
          <input className="border rounded px-3 py-2" placeholder="Role" value={newStaff.role} onChange={e=>setNewStaff({...newStaff, role:e.target.value})} />
          <input className="border rounded px-3 py-2" placeholder="Phone" value={newStaff.phone} onChange={e=>setNewStaff({...newStaff, phone:e.target.value})} />
          <input className="border rounded px-3 py-2" placeholder="Email" value={newStaff.email} onChange={e=>setNewStaff({...newStaff, email:e.target.value})} />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={!!busy.add}>Add Staff</Button>
        </div>
      </form>

      <div className="bg-white rounded-lg shadow">
        <table className="min-w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Role</th>
              <th className="text-left p-3">Phone</th>
              <th className="text-left p-3">Email</th>
              <th className="text-right p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(staff || []).map(s => (
              <tr key={s.id} className="border-t">
                <td className="p-3"><input className="border rounded px-2 py-1 w-full" defaultValue={s.name || ''} onBlur={e=>update(s.id, { name: e.target.value })} disabled={!!busy[s.id]} /></td>
                <td className="p-3"><input className="border rounded px-2 py-1 w-full" defaultValue={s.role || ''} onBlur={e=>update(s.id, { role: e.target.value })} disabled={!!busy[s.id]} /></td>
                <td className="p-3"><input className="border rounded px-2 py-1 w-full" defaultValue={s.phone || ''} onBlur={e=>update(s.id, { phone: e.target.value })} disabled={!!busy[s.id]} /></td>
                <td className="p-3"><input className="border rounded px-2 py-1 w-full" defaultValue={s.email || ''} onBlur={e=>update(s.id, { email: e.target.value })} disabled={!!busy[s.id]} /></td>
                <td className="p-3 text-right">
                  <Button variant="danger" onClick={()=>removeItem(s.id)} disabled={!!busy[s.id]}>Remove</Button>
                </td>
              </tr>
            ))}
            {(!staff || staff.length === 0) && (
              <tr><td className="p-4 text-gray-500" colSpan={5}>{loading ? 'Loading...' : 'No staff yet.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
