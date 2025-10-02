import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import Input from '../components/ui/Input';
import Select from '../components/ui/Select';

export default function OrgVolunteers() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [org, setOrg] = useState(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgName, setOrgName] = useState('');
  const [orgDesc, setOrgDesc] = useState('');
  const [vols, setVols] = useState([]);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [addRole, setAddRole] = useState('Member');
  const [rowBusyId, setRowBusyId] = useState(null);
  const pendingRef = useRef(0);

  useEffect(() => {
    // Treat the account itself as the organization: fetch or auto-create
    (async () => {
      try {
        setOrgLoading(true);
        const mine = await api.socialOrgMine();
        setOrg(mine || null);
      } catch {
        // Fallback: list endpoint (legacy environments)
        try {
          const orgs = await api.request('/social/organizations/list');
          const list = orgs.results || [];
          const fallback = list.find(o => o.user_id === me?.id) || list[0] || null;
          setOrg(fallback);
        } catch {
          setOrg(null);
        }
      } finally {
        setOrgLoading(false);
      }
    })();
  }, [me?.id]);

  const load = async (oid) => {
    if (!oid) return;
    try {
      const r = await api.socialOrgListVolunteers(oid);
      setVols(r.results || []);
    } catch {}
  };
  useEffect(() => { if (org?.id) load(org.id); }, [org?.id]);

  const doSearch = async (term) => {
    if (!term.trim()) { setResults([]); return; }
    pendingRef.current += 1;
    const token = pendingRef.current;
    try {
      const resp = await api.searchUsers(term.trim());
      if (token === pendingRef.current) setResults(resp.results || []);
    } catch { /* ignore */ }
  };
  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => doSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const addVol = async (user) => {
    if (!org?.id || !user?.id) return;
    setRowBusyId(user.id);
    try {
      await api.socialOrgAddVolunteer(org.id, user.id, addRole || 'Member');
      await load(org.id);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to add' } }));
    } finally { setRowBusyId(null); }
  };

  const setStatus = async (vol, status) => {
    if (!org?.id || !vol?.id) return;
    setRowBusyId(vol.id);
    try {
      await api.socialOrgUpdateVolunteer(org.id, vol.id, { status });
      await load(org.id);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to update' } }));
    } finally { setRowBusyId(null); }
  };

  const setRole = async (vol, role_label) => {
    if (!org?.id || !vol?.id) return;
    setRowBusyId(vol.id);
    try {
      await api.socialOrgUpdateVolunteer(org.id, vol.id, { role_label });
      await load(org.id);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to update role' } }));
    } finally { setRowBusyId(null); }
  };

  const deleteVol = async (vol) => {
    if (!org?.id || !vol?.id) return;
    if (!window.confirm(`Remove ${vol.user_full_name || vol.user_email || 'this user'} from your organization?`)) return;
    setRowBusyId(vol.id);
    try {
      await api.socialOrgRemoveVolunteer(org.id, vol.id);
      await load(org.id);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to delete' } }));
    } finally { setRowBusyId(null); }
  };

  const createOrg = async () => {
    const name = (orgName || '').trim();
    if (!name) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Organization name is required.' } }));
      return;
    }
    setBusy(true);
    try {
      const resp = await api.request('/social/organizations', 'POST', { name, description: orgDesc || null });
      const newOrg = { id: resp.id, name };
      setOrg(newOrg);
      setOrgName(''); setOrgDesc('');
      await load(resp.id);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to create organization' } }));
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <div className="mb-4">
        <h2 className="text-2xl font-semibold">Volunteers</h2>
        <p className="text-sm text-gray-600 mt-1">Manage your organization’s volunteers: invite existing users, set roles, and approve participation.</p>
      </div>
      {orgLoading && <div className="text-gray-500">Loading organization…</div>}
      {!orgLoading && !org && (
        <>
          <div className="mb-4">
            <div className="text-sm text-gray-600">No organization found for your account.</div>
            <div className="text-sm text-gray-600">Create one to start adding volunteers.</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <input value={orgName} onChange={e => setOrgName(e.target.value)} className="border rounded px-3 py-2" placeholder="Organization name" />
            <input value={orgDesc} onChange={e => setOrgDesc(e.target.value)} className="border rounded px-3 py-2" placeholder="Description (optional)" />
          </div>
          <button disabled={busy} onClick={createOrg} className="px-4 py-2 bg-indigo-600 text-white rounded">Create Organization</button>
        </>
      )}
      {org && (
        <>
          <div className="mb-5">
            <div className="text-sm text-gray-600">Organization</div>
            <div className="font-semibold">{org.name || `Org #${org.id}`}</div>
          </div>

          <div className="mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="md:col-span-3">
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search users by name or email" label="Find people" />
              </div>
              <div>
                <Select label="Role on add" value={addRole} onChange={e => setAddRole(e.target.value)} options={[
                  { value: 'Leader', label: 'Leader' },
                  { value: 'Coordinator', label: 'Coordinator' },
                  { value: 'Member', label: 'Member' },
                  { value: 'Volunteer', label: 'Volunteer' },
                ]} />
              </div>
            </div>
            {results.length > 0 && (
              <div className="mt-3 border rounded divide-y">
                {results.map(u => (
                  <div key={u.id} className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-semibold">
                        {(u.full_name || u.email || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold">{u.full_name || u.email}</div>
                        <div className="text-xs text-gray-500">{u.email}</div>
                      </div>
                    </div>
                    <Button variant="primary" size="sm" loading={rowBusyId===u.id} onClick={() => addVol(u)}>Add</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            {/* Pending Requests */}
            {vols.some(v => v.status === 'pending') && (
              <div className="mb-6">
                <h3 className="font-semibold mb-3">Pending Volunteer Requests</h3>
                <div className="divide-y border rounded">
                  {vols.filter(v => v.status === 'pending').map(v => (
                    <div key={v.id} className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-semibold">
                          {(v.user_full_name || v.user_email || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold">{v.user_full_name || v.user_email || `User #${v.user_id}`}</div>
                          <div className="text-xs text-gray-500">Requested to join • Status: {v.status}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <input defaultValue={v.role_label || ''} onBlur={(e) => { const val = e.target.value.trim(); if (val !== (v.role_label||'')) setRole(v, val || null); }} className="border rounded px-2 py-1 text-sm" placeholder="Role on accept" />
                        <Button size="sm" variant="primary" loading={rowBusyId===v.id} onClick={() => setStatus(v, 'accepted')}>Accept</Button>
                        <Button size="sm" variant="outline" onClick={() => setStatus(v, 'rejected')}>Reject</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Current Volunteers */}
            <h3 className="font-semibold mb-3">Current Volunteers</h3>
            <div className="divide-y border rounded">
              {vols.filter(v => v.status === 'accepted').length === 0 && <div className="text-gray-500">No volunteers yet.</div>}
              {vols.filter(v => v.status === 'accepted').map(v => (
                <div key={v.id} className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-semibold">
                      {(v.user_full_name || v.user_email || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        {v.user_full_name || v.user_email || `User #${v.user_id}`}
                        {v.role_label && <Badge className="ml-1" variant="default">{v.role_label}</Badge>}
                      </div>
                      <div className="text-xs text-gray-500">Status: {v.status}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Role select with presets + Custom */}
                    <Select
                      value={['Leader','Coordinator','Member','Volunteer'].includes(v.role_label) ? v.role_label : (v.role_label ? 'Custom' : 'Member')}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'Custom') return; // Show custom field instead
                        setRole(v, val);
                      }}
                      options={[
                        { value: 'Leader', label: 'Leader' },
                        { value: 'Coordinator', label: 'Coordinator' },
                        { value: 'Member', label: 'Member' },
                        { value: 'Volunteer', label: 'Volunteer' },
                        { value: 'Custom', label: 'Custom…' },
                      ]}
                      className="w-[150px]"
                    />
                    {(!['Leader','Coordinator','Member','Volunteer'].includes(v.role_label)) && (
                      <input
                        defaultValue={v.role_label || ''}
                        onBlur={(e) => { const val = e.target.value.trim(); if (val !== (v.role_label||'')) setRole(v, val || null); }}
                        className="border rounded px-2 py-1 text-sm"
                        placeholder="Custom role"
                      />
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setStatus(v, 'removed')}>Soft Remove</Button>
                    <Button size="sm" variant="danger" loading={rowBusyId===v.id} onClick={() => deleteVol(v)}>Delete</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
