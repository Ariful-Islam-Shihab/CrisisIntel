import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';

export default function CampaignDetail() {
  const { id } = useParams();
  const cid = Number(id);
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [camp, setCamp] = useState(null);
  const [parts, setParts] = useState([]);
  const [usersById, setUsersById] = useState({});
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  // Finance transparency state
  const [donations, setDonations] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [finance, setFinance] = useState(null);
  const [financeLoading, setFinanceLoading] = useState(false);
  const [showDonate, setShowDonate] = useState(false);
  const [donAmount, setDonAmount] = useState('');
  const [donNote, setDonNote] = useState('');
  // Organization context for owner tools
  const [org, setOrg] = useState(null);
  const [orgVols, setOrgVols] = useState([]);
  const [orgSel, setOrgSel] = useState({}); // { [user_id]: true }
  const [orgLoading, setOrgLoading] = useState(false);
  // Helper to derive a user id from various possible shapes
  const getUserId = (v) => {
    if (!v || typeof v !== 'object') return null;
    return (
      v.user_id ??
      v.userId ??
      (v.user && (v.user.id ?? v.user.user_id)) ??
      v.member_user_id ??
      v.volunteer_user_id ??
      v.uid ??
      null
    );
  };
  const isOwner = camp && camp.owner_user_id === me?.id;
  const canPublish = isOwner && camp?.status === 'draft';
  const canComplete = isOwner && camp?.status === 'active';
  const canCancel = isOwner && (camp?.status === 'draft' || camp?.status === 'active');

  const load = async () => {
    try {
      const c = await api.request(`/campaigns/${cid}`);
      setCamp(c);
      const p = await api.request(`/campaigns/${cid}/participants`);
      setParts(p.results || []);
      // Load finance in background
      setFinanceLoading(true);
      Promise.all([
        api.campaignFinanceSummary(cid).catch(() => null),
        api.campaignListDonations(cid).catch(() => ({ results: [] })),
        api.campaignListExpenses(cid).catch(() => ({ results: [] })),
      ]).then(([sum, dons, exps]) => {
        setFinance(sum);
        setDonations((dons?.results || dons || []).slice(0, 200));
        setExpenses((exps?.results || exps || []).slice(0, 200));
      }).finally(() => setFinanceLoading(false));
    } catch {}
  };
  useEffect(() => { load(); }, [cid]);

  // Whenever participants change, fetch missing user profiles for display
  useEffect(() => {
    const needIds = parts
      .map(p => p.user_id)
      .filter(uid => uid && !usersById[uid]);
    if (needIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = {};
      for (const uid of needIds) {
        try {
          const u = await api.getUserPublic(uid);
          if (u && u.id) entries[uid] = u;
        } catch {}
      }
      if (!cancelled && Object.keys(entries).length) {
        setUsersById(prev => ({ ...prev, ...entries }));
      }
    })();
    return () => { cancelled = true; };
  }, [parts]);

  // If owner, load my organization and its volunteers
  useEffect(() => {
    if (!isOwner) { setOrg(null); setOrgVols([]); setOrgSel({}); return; }
    let cancelled = false;
    (async () => {
      try {
        setOrgLoading(true);
        const mine = await api.socialOrgMine();
        if (cancelled) return;
        if (mine && mine.id) {
          setOrg(mine);
          const list = await api.socialOrgListVolunteers(mine.id);
          if (cancelled) return;
          const vols = (list?.results || list || []).filter(v => (v.status || '').toLowerCase() === 'accepted');
          setOrgVols(vols);
        } else {
          setOrg(null); setOrgVols([]);
        }
      } catch (e) {
        // fail silent
      } finally {
        if (!cancelled) setOrgLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOwner]);

  // Fetch public profiles for org volunteers too (robust user id detection)
  useEffect(() => {
    const needIds = orgVols
      .map(v => getUserId(v))
      .filter(uid => uid && !usersById[uid]);
    if (needIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = {};
      for (const uid of needIds) {
        try {
          const u = await api.getUserPublic(uid);
          if (u && u.id) entries[uid] = u;
        } catch {}
      }
      if (!cancelled && Object.keys(entries).length) {
        setUsersById(prev => ({ ...prev, ...entries }));
      }
    })();
    return () => { cancelled = true; };
  }, [orgVols]);

  // Fetch public profiles for donors/spenders displayed in finance lists
  useEffect(() => {
    const donorIds = (donations || []).map(d => d.user_id ?? d.donor_user_id ?? d.created_by_user_id ?? (d.user && (d.user.id ?? d.user.user_id)) ?? null);
    const spenderIds = (expenses || []).map(e => e.user_id ?? e.spender_user_id ?? e.created_by_user_id ?? (e.user && (e.user.id ?? e.user.user_id)) ?? null);
    const needIds = [...new Set([...donorIds, ...spenderIds].filter(uid => !!uid && !usersById[uid]))];
    if (needIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = {};
      for (const uid of needIds) {
        try {
          const u = await api.getUserPublic(uid);
          if (u && u.id) entries[uid] = u;
        } catch {}
      }
      if (!cancelled && Object.keys(entries).length) setUsersById(prev => ({ ...prev, ...entries }));
    })();
    return () => { cancelled = true; };
  }, [donations, expenses]);

  const join = async () => {
    const ok = window.confirm('Request to join this campaign? The owner will review your request.');
    if (!ok) return;
    setBusy(true);
    try {
      await api.request(`/campaigns/${cid}/join`, 'POST', {});
      await load();
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes('already_participating')) {
        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'You are already a participant of this campaign.' } }));
      } else if (msg.includes('already_pending')) {
        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'You already have a pending request. Please wait for approval.' } }));
      } else {
        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Join failed' } }));
      }
      // Even on errors like "already_participating", refresh to reflect current status
      try { await load(); } catch {}
    } finally { setBusy(false); }
  };

  const changeStatus = async (status) => {
    if (!isOwner) return;
    setBusy(true);
    try {
      await api.request(`/campaigns/${cid}/status`, 'POST', { status });
      await load();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Status change failed' } }));
    } finally { setBusy(false); }
  };

  const confirmDeleteParticipant = async (participantId) => {
    if (!isOwner) return;
    const ok = window.confirm('Delete this participant from the campaign? This cannot be undone.');
    if (!ok) return;
    try {
      setBusy(true);
      await api.request(`/campaigns/${cid}/participants/${participantId}`, 'DELETE');
      await load();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Delete failed' } }));
    } finally { setBusy(false); }
  };

  const withdrawSelf = async () => {
    try {
      setBusy(true);
      await api.request(`/campaigns/${cid}/withdraw`, 'POST', {});
      await load();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Withdraw failed' } }));
    } finally { setBusy(false); }
  };

  const onSearch = async () => {
    if (!q.trim()) { setResults([]); return; }
    try {
      const resp = await api.searchUsers(q.trim());
      const items = (resp.results || []).map(u => ({ ...u, _selected: false }));
      setResults(items);
    } catch {}
  };

  const toggleSel = (id) => {
    setResults(prev => prev.map(r => r.id === id ? { ...r, _selected: !r._selected } : r));
  };

  const toggleOrgSel = (user_id) => {
    setOrgSel(prev => ({ ...prev, [user_id]: !prev[user_id] }));
  };

  const addSelected = async () => {
    if (!isOwner) return;
    const idsFromSearch = results.filter(r => r._selected).map(r => r.id);
    const idsFromOrg = Object.entries(orgSel).filter(([, v]) => !!v).map(([k]) => Number(k));
    const combined = Array.from(new Set([...idsFromSearch, ...idsFromOrg]));
    const existing = new Set(parts.map(p => p.user_id));
    const finalIds = combined.filter(uid => !existing.has(uid));
    if (!finalIds.length) return;
    setBusy(true);
    try {
      await api.campaignAddVolunteers(cid, finalIds, 'Volunteer');
      await load();
      setResults([]); setQ(''); setOrgSel({});
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Add failed' } }));
    } finally { setBusy(false); }
  };

  const onDonate = async () => {
    if (!me) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Please login to donate.' } }));
      return;
    }
    const amt = parseFloat(donAmount);
    if (!isFinite(amt) || amt <= 0) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Enter a valid donation amount.' } }));
      return;
    }
    try {
      setBusy(true);
      await api.campaignAddDonation(cid, amt, 'BDT', donNote || null);
      setShowDonate(false);
      setDonAmount(''); setDonNote('');
      // refresh finance lists
      const [sum, dons] = await Promise.all([
        api.campaignFinanceSummary(cid).catch(()=>null),
        api.campaignListDonations(cid).catch(()=>({ results: [] })),
      ]);
      setFinance(sum);
      setDonations((dons?.results || dons || []).slice(0, 200));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Donation failed' } }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="bg-white p-5 rounded-lg shadow md:col-span-2">
        {!camp ? (
          <div className="text-gray-500">Loading…</div>
        ) : (
          <>
            <h2 className="text-2xl font-semibold">{camp.title}</h2>
            <div className="text-gray-600">{camp.location_text || '—'}</div>
            <div className="text-sm text-gray-500 mb-3">Status: {camp.status}</div>
            {isOwner && (
              <div className="flex gap-2 mb-3">
                {canPublish && <button disabled={busy} onClick={() => changeStatus('active')} className="px-4 py-2 bg-indigo-600 text-white rounded">Publish</button>}
                {canComplete && <button disabled={busy} onClick={() => changeStatus('completed')} className="px-4 py-2 bg-emerald-600 text-white rounded">Mark Completed</button>}
                {canCancel && <button disabled={busy} onClick={() => changeStatus('cancelled')} className="px-4 py-2 bg-red-600 text-white rounded">Cancel</button>}
                <button disabled={busy} onClick={() => setShowDonate(true)} className="px-4 py-2 bg-amber-500 text-white rounded">Donate</button>
              </div>
            )}
            {(!isOwner) && (() => {
              const myPart = parts.find(p => p.user_id===me?.id && p.status!=='withdrawn');
              const hasMembership = !!myPart;
              const withdrawLabel = myPart?.status === 'accepted' ? 'Remove myself' : 'Cancel request';
              return (
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    {!hasMembership && (
                      <button disabled={busy} onClick={join} className="px-4 py-2 bg-emerald-600 text-white rounded">Join Campaign</button>
                    )}
                    {hasMembership && (
                      <button disabled={busy} onClick={withdrawSelf} className="px-4 py-2 bg-red-50 text-red-700 border rounded">{withdrawLabel}</button>
                    )}
                    <button disabled={busy} onClick={() => setShowDonate(true)} className="px-4 py-2 bg-amber-500 text-white rounded">Donate</button>
                  </div>
                  {myPart && myPart.status !== 'accepted' && (
                    <div className="text-xs text-gray-600">Your request is <span className="font-medium">{myPart.status}</span>. The owner will review it shortly.</div>
                  )}
                </div>
              );
            })()}
            <div className="mt-6">
              <h3 className="font-semibold mb-2">Participants</h3>
              {parts.length>0 && (
                <div className="flex gap-3 text-xs mb-2">
                  <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 border">Accepted: {parts.filter(p=>p.status==='accepted').length}</span>
                  <span className="px-2 py-1 rounded bg-yellow-50 text-yellow-700 border">Pending: {parts.filter(p=>p.status!=='accepted' && p.status!=='rejected' && p.status!=='withdrawn').length}</span>
                  <span className="px-2 py-1 rounded bg-red-50 text-red-700 border">Rejected: {parts.filter(p=>p.status==='rejected').length}</span>
                </div>
              )}
              <div className="divide-y">
                {parts.length === 0 && <div className="text-gray-500">No participants yet.</div>}
                {parts.map(p => (
                  <div key={p.id} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{usersById[p.user_id]?.full_name || usersById[p.user_id]?.email || `User #${p.user_id}`}</div>
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        <span>Status: {p.status}</span>
                        {isOwner ? (
                          <>
                            <span>•</span>
                            <span>Role:</span>
                            <select
                              className="text-xs border rounded px-1 py-0.5"
                              value={p.role_label || ''}
                              onChange={async (e) => {
                                const rl = e.target.value || null;
                                try {
                                  setBusy(true);
                                  // Try role update via a dedicated endpoint if available; otherwise reuse status endpoint shape
                                  await api.request(`/campaigns/${cid}/participants/${p.id}/status`, 'POST', { role_label: rl, status: p.status });
                                  await load();
                                } catch (err) {
                                  window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Update role failed' } }));
                                } finally { setBusy(false); }
                              }}
                            >
                              <option value="">Volunteer</option>
                              <option value="Team Lead">Team Lead</option>
                              <option value="Coordinator">Coordinator</option>
                              <option value="Medic">Medic</option>
                              <option value="Logistics">Logistics</option>
                            </select>
                          </>
                        ) : (
                          <span>• Role: {p.role_label || 'Volunteer'}</span>
                        )}
                      </div>
                    </div>
                    {isOwner && (
                      <div className="flex gap-2">
                        <button disabled={busy || p.status==='accepted'} onClick={() => api.request(`/campaigns/${cid}/participants/${p.id}/status`, 'POST', { status: 'accepted' }).then(load).catch(e=>window.dispatchEvent(new CustomEvent('api-error',{detail:{message:e.message}})))} className="px-3 py-1 text-xs rounded bg-emerald-50 text-emerald-700 border">Accept</button>
                        <button disabled={busy || p.status==='rejected'} onClick={() => api.request(`/campaigns/${cid}/participants/${p.id}/status`, 'POST', { status: 'rejected' }).then(load).catch(e=>window.dispatchEvent(new CustomEvent('api-error',{detail:{message:e.message}})))} className="px-3 py-1 text-xs rounded bg-yellow-50 text-yellow-700 border">Reject</button>
                        <button disabled={busy} onClick={() => confirmDeleteParticipant(p.id)} className="px-3 py-1 text-xs rounded bg-red-600 text-white">Delete</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Finance & Transparency */}
            <div className="mt-8">
              <h3 className="font-semibold mb-3">Finance & Transparency</h3>
              {financeLoading && <div className="text-gray-400 text-sm">Loading finance…</div>}
              {!financeLoading && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <div className="border rounded p-3 bg-emerald-50">
                    <div className="text-xs text-emerald-700">Total Raised</div>
                    <div className="text-lg font-semibold text-emerald-800">{(finance?.total_donations ?? donations.reduce((s,d)=>s+(Number(d.amount)||0),0)).toLocaleString()} {finance?.currency || (donations[0]?.currency || 'BDT')}</div>
                  </div>
                  <div className="border rounded p-3 bg-amber-50">
                    <div className="text-xs text-amber-700">Total Spent</div>
                    <div className="text-lg font-semibold text-amber-800">{(finance?.total_expenses ?? expenses.reduce((s,e)=>s+(Number(e.amount)||0),0)).toLocaleString()} {finance?.currency || (expenses[0]?.currency || 'BDT')}</div>
                  </div>
                  <div className="border rounded p-3 bg-indigo-50">
                    <div className="text-xs text-indigo-700">Balance</div>
                    <div className="text-lg font-semibold text-indigo-800">{(
                      (finance?.balance != null)
                        ? finance.balance
                        : (donations.reduce((s,d)=>s+(Number(d.amount)||0),0) - expenses.reduce((s,e)=>s+(Number(e.amount)||0),0))
                    ).toLocaleString()} {finance?.currency || (donations[0]?.currency || expenses[0]?.currency || 'BDT')}</div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium">Donations</div>
                    <button onClick={() => setShowDonate(true)} className="text-sm px-3 py-1 rounded bg-amber-500 text-white">Donate</button>
                  </div>
                  <div className="border rounded divide-y max-h-80 overflow-auto">
                    {(!donations || donations.length===0) && <div className="p-3 text-sm text-gray-500">No donations yet.</div>}
                    {donations.map(d => {
                      const uid = d.user_id ?? d.donor_user_id ?? d.created_by_user_id ?? (d.user && (d.user.id ?? d.user.user_id)) ?? null;
                      const who = uid ? (usersById[uid]?.full_name || usersById[uid]?.email || `User #${uid}`) : (d.donor_name || 'Anonymous');
                      const ts = d.created_at || d.timestamp || d.created || d.added_at || '';
                      return (
                        <div key={d.id} className="p-3 flex items-center justify-between">
                          <div>
                            <div className="text-sm text-gray-800">{who}</div>
                            {ts && <div className="text-[11px] text-gray-500">{String(ts).replace('T',' ').slice(0,19)}</div>}
                            {d.note && <div className="text-[12px] text-gray-600 mt-1">{d.note}</div>}
                          </div>
                          <div className="text-sm font-semibold text-emerald-700">{Number(d.amount).toLocaleString()} {d.currency || 'BDT'}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <div className="font-medium mb-2">Expenses</div>
                  <div className="border rounded divide-y max-h-80 overflow-auto">
                    {(!expenses || expenses.length===0) && <div className="p-3 text-sm text-gray-500">No expenses recorded.</div>}
                    {expenses.map(e => {
                      const uid = e.user_id ?? e.spender_user_id ?? e.created_by_user_id ?? (e.user && (e.user.id ?? e.user.user_id)) ?? null;
                      const who = uid ? (usersById[uid]?.full_name || usersById[uid]?.email || `User #${uid}`) : '—';
                      const ts = e.created_at || e.timestamp || e.created || e.added_at || '';
                      const cat = e.category || e.type || 'Expense';
                      return (
                        <div key={e.id} className="p-3">
                          <div className="flex items-center justify-between">
                            <div className="text-sm text-gray-800">{cat}</div>
                            <div className="text-sm font-semibold text-amber-700">{Number(e.amount).toLocaleString()} {e.currency || 'BDT'}</div>
                          </div>
                          <div className="text-[11px] text-gray-500">{who}{ts ? ` • ${String(ts).replace('T',' ').slice(0,19)}` : ''}</div>
                          {e.description && <div className="text-[12px] text-gray-700 mt-1">{e.description}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="text-[11px] text-gray-500 mt-2">All donations and expenses are public for transparency.</div>
            </div>

            {/* Donate modal */}
            {showDonate && (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-5">
                  <div className="text-lg font-semibold mb-3">Donate to {camp.title}</div>
                  <div className="mb-3">
                    <label className="block text-sm text-gray-700 mb-1">Amount (BDT)</label>
                    <input type="number" min="1" step="0.01" value={donAmount} onChange={e=>setDonAmount(e.target.value)} className="w-full border rounded px-3 py-2" placeholder="e.g. 500" />
                  </div>
                  <div className="mb-4">
                    <label className="block text-sm text-gray-700 mb-1">Note (optional)</label>
                    <textarea value={donNote} onChange={e=>setDonNote(e.target.value)} rows={3} className="w-full border rounded px-3 py-2" placeholder="A message with your donation" />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={()=>setShowDonate(false)} className="px-4 py-2 border rounded">Cancel</button>
                    <button disabled={busy} onClick={onDonate} className="px-4 py-2 bg-amber-500 text-white rounded">Confirm Donation</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="bg-white p-5 rounded-lg shadow">
        <h3 className="font-semibold mb-2">Owner Tools</h3>
        {!isOwner && <div className="text-gray-500">Only the owner sees tools.</div>}
        {isOwner && (
          <>
            <div className="text-sm text-gray-600 mb-2">Add existing users as volunteers</div>
            {org && (
              <div className="mb-3">
                <div className="text-sm font-medium mb-1">My Organization Volunteers</div>
                <div className="max-h-64 overflow-y-auto border rounded">
                  {orgLoading && (
                    <div className="px-3 py-2 text-gray-400 text-xs">Loading volunteers…</div>
                  )}
                  {!orgLoading && orgVols.length === 0 && (
                    <div className="px-3 py-2 text-gray-500 text-sm">No accepted volunteers in your organization.</div>
                  )}
                  <ul className="divide-y">
                    {orgVols.map((v) => {
                      const uid = v?.user_id ?? getUserId(v);
                      const already = !!uid && parts.some(p => p.user_id === uid);
                      // Prefer API-provided labels to avoid async profile lag
                      const nameOrEmail = v?.user_full_name || v?.full_name || v?.user_email || v?.email || (uid ? `User #${uid}` : 'Volunteer');
                      return (
                        <li key={`${uid ?? 'noid'}-${v.id ?? 'v'}`} className="flex items-center px-3 py-2">
                          <input
                            type="checkbox"
                            className="shrink-0 align-middle mr-3"
                            disabled={!uid || already}
                            checked={!!uid && !!orgSel[uid]}
                            onChange={() => uid && toggleOrgSel(uid)}
                          />
                          <div className="text-sm" style={{color:'#111'}}>{nameOrEmail}</div>
                          {already && (
                            <span className="ml-auto text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">Already added</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key==='Enter') onSearch(); }} className="border rounded px-3 py-2 w-full" placeholder="Search users" />
              <button onClick={onSearch} className="px-3 py-2 bg-gray-100 rounded">Search</button>
            </div>
            {results.length>0 && (
              <div className="mt-2 max-h-64 overflow-auto border rounded p-2">
                {results.map(r => (
                  <div
                    key={r.id}
                    className="flex items-center py-1 gap-2 cursor-pointer"
                    style={{ justifyContent: 'flex-start' }}
                    onClick={() => { if (!parts.some(p=>p.user_id===r.id)) toggleSel(r.id); }}
                  >
                    <input
                      className="shrink-0 align-middle"
                      type="checkbox"
                      disabled={parts.some(p=>p.user_id===r.id)}
                      checked={!!r._selected}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleSel(r.id)}
                    />
                    <span className="text-gray-800" title={r.full_name || r.email || `User #${r.id}`}>{r.full_name || r.email || `User #${r.id}`}</span>
                    {parts.some(p=>p.user_id===r.id) && <span className="text-xs text-gray-400">• Already added</span>}
                  </div>
                ))}
                <button
                  disabled={busy || (new Set([...
                    results.filter(r=>r._selected).map(r=>r.id),
                    ...Object.entries(orgSel).filter(([,v])=>v).map(([k])=>Number(k))
                  ])).size === 0}
                  onClick={addSelected}
                  className="mt-2 w-full py-2 bg-indigo-600 text-white rounded"
                >
                  {(() => {
                    const count = (new Set([...
                      results.filter(r=>r._selected).map(r=>r.id),
                      ...Object.entries(orgSel).filter(([,v])=>v).map(([k])=>Number(k))
                    ])).size;
                    return `Add Selected (${count})`;
                  })()}
                </button>
              </div>
            )}
            {results.length === 0 && (
              <button
                disabled={busy || (new Set(Object.entries(orgSel).filter(([,v])=>v).map(([k])=>Number(k)))).size === 0}
                onClick={addSelected}
                className="mt-2 w-full py-2 bg-indigo-600 text-white rounded"
              >
                {(() => {
                  const count = (new Set(Object.entries(orgSel).filter(([,v])=>v).map(([k])=>Number(k)))).size;
                  return `Add Selected (${count})`;
                })()}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
