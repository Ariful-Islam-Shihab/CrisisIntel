import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';

function Field({ label, children }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-36 text-sm text-gray-600">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// Small helper to avoid duplicate participation requests and give better UX
function RequestParticipateButton({ id, roleLabel, disabled }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy || disabled}
      className={`px-3 py-2 rounded text-white ${busy ? 'bg-emerald-400 cursor-not-allowed' : 'bg-emerald-600'}`}
      onClick={async () => {
        if (busy || disabled) return;
        setBusy(true);
        try {
          const note = window.prompt('Optional note for admins (e.g., capabilities, resources):', '') || null;
          const res = await api.crisisParticipationRequest(id, roleLabel || 'volunteer', note);
          const dup = res && (res.duplicate || res.reopened);
          const msg = dup ? 'Participation request is already on file.' : 'Participation request sent for approval.';
          window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
          try { window.dispatchEvent(new Event('mine-refresh')); } catch {}
        } catch (e) {
          const m = String((e && e.message) || 'Failed to request participation');
          // If backend says already_approved or already_participant, surface a clear message
          const normalized = /already_/i.test(m) ? 'You are already a participant or already approved.' : m;
          window.dispatchEvent(new CustomEvent('api-error', { detail: { message: normalized } }));
          if (/already_/i.test(m)) {
            try { window.dispatchEvent(new Event('participants-refresh')); } catch {}
            try { window.dispatchEvent(new Event('mine-refresh')); } catch {}
          }
        } finally {
          // keep disabled briefly to avoid hammering; UX can be refined later with status polling
          setTimeout(() => setBusy(false), 1500);
        }
      }}
    >{busy ? 'Requesting…' : 'Request to Participate'}</button>
  );
}
function AllRequestsPanel({ crisisId, isAdmin, isBloodBank, isDonor, isFireService }) {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  // Fire service: department + teams + deploy state
  const [myDepartments, setMyDepartments] = useState([]);
  const [deployDeptId, setDeployDeptId] = useState(null);
  const [teamsCache, setTeamsCache] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [deployBusy, setDeployBusy] = useState({}); // request_id -> bool
  const [deployMsg, setDeployMsg] = useState({});   // request_id -> string

  const loadPage = useCallback(async (p = 1) => {
    setLoading(true); setMsg('');
    try {
      const r = await api.crisisRequestsAll(
        crisisId,
        { page: p, page_size: pageSize },
        { suppressStatus: [403], suppressCodes: ['forbidden'], silent: true }
      );
      let arr = Array.isArray(r) ? r : (r?.results || []);
      // Ensure newest-first ordering on first page regardless of backend
      if (p === 1) {
        arr = [...arr].sort((a,b)=>{
          const at = new Date(a.created_at || a.target_datetime || 0).getTime();
          const bt = new Date(b.created_at || b.target_datetime || 0).getTime();
          if (bt !== at) return bt - at;
          return (b.id||0) - (a.id||0);
        });
      }
      setItems(prev => p === 1 ? arr : prev.concat(arr));
      setPage(p);
      const total = r?.total || 0;
      const next = r?.next_page || 0;
      setHasMore((next && next > p) || (total > p * pageSize));
    } catch (e) {
      // 403 means user isn't a participant or enrolled victim; show a quiet inline note
      const m = (e && e.message) || '';
      if (/permission|forbidden|403/i.test(m)) setMsg('Join as a participant or enroll as victim to view the crisis-wide request feed.');
      else setMsg(m || 'Failed to load');
    } finally { setLoading(false); }
  }, [crisisId]);

  useEffect(() => { loadPage(1); }, [loadPage]);
  useEffect(() => {
    function onUpdated() { loadPage(1); }
    window.addEventListener('requests-updated', onUpdated);
    return () => { window.removeEventListener('requests-updated', onUpdated); };
  }, [loadPage]);

  // Fire service: load departments (to detect ownership) and teams
  useEffect(() => {
    if (!isFireService) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.listFireDepartments();
        if (cancelled) return;
        const list = r.results || r.items || r || [];
        const arr = Array.isArray(list) ? list : [];
        setMyDepartments(arr);
        // Initialize selected department: prefer owned; else if exactly one present, pick it
        const owned = arr.find(d => d.user_id === me?.id);
        if (owned) setDeployDeptId(owned.id);
        else if (arr.length === 1) setDeployDeptId(arr[0].id);
      } catch (e) {
        // non-fatal
      }
    })();
    return () => { cancelled = true; };
  }, [isFireService, me?.id]);

  const loadTeams = useCallback(async () => {
    if (!isFireService || !deployDeptId) { setTeamsCache([]); return; }
    setTeamsLoading(true);
    try {
      const data = await api.listFireTeams(deployDeptId);
      const list = (data && (data.items || data.results)) || [];
      setTeamsCache(list);
    } catch (e) {
      setTeamsCache([]);
    } finally { setTeamsLoading(false); }
  }, [isFireService, deployDeptId]);

  useEffect(() => { if (deployDeptId) loadTeams(); }, [deployDeptId, loadTeams]);

  async function act(req, status) {
    try {
      if (status === 'rejected' && !window.confirm('Are you sure you want to reject this request?')) return;
      if (req.type === 'inventory') {
        if (status === 'cancelled') {
          if (!window.confirm('Cancel this blood inventory request?')) return;
          await api.updateInventoryRequestStatus(req.id, 'cancelled', {});
        } else {
          await api.updateInventoryRequestStatus(req.id, status, {});
        }
      } else if (req.type === 'donor') {
        const extra = {};
        if (status === 'completed') {
          const cd = window.prompt('Cooldown days for donor (optional, 0 to skip)', '10');
          if (cd != null && cd !== '') extra.cooldown_days = parseInt(cd, 10) || 0;
        }
        if (status === 'cancelled') {
          if (!window.confirm('Cancel this donor meeting request?')) return;
          await api.updateDonorMeetingRequestStatus(req.id, 'cancelled', {});
        } else {
          await api.updateDonorMeetingRequestStatus(req.id, status, extra);
        }
      } else if (req.type === 'hospital') {
        if (status === 'cancelled') {
          if (!window.confirm('Cancel this hospital booking? You can cancel up to 2 hours before the scheduled time.')) return;
          await api.cancelServiceBooking(req.id);
        } else if (status === 'confirmed') {
          await api.confirmServiceBooking(req.id);
        } else if (status === 'declined') {
          if (!window.confirm('Decline this booking? The requester will be notified.')) return;
          await api.declineServiceBooking(req.id);
        }
      } else if (req.type === 'fire') {
        if (status === 'cancelled') {
          if (!window.confirm('Cancel this fire service request?')) return;
          await api.cancelFireRequest(req.id);
        }
      }
      await loadPage(page);
    } catch (e) { setMsg(e.message || 'Failed to update'); }
  }

  function canAct(req, status) {
    // Admins can always act
    if (isAdmin) return true;
    if (req.type === 'inventory') {
      // Bank user owning the request can act
      return isBloodBank && Number(req.bank_user_id) === Number(me?.id);
    }
    if (req.type === 'donor') {
      // Donor targeted by the request can act
      return isDonor && Number(req.donor_user_id) === Number(me?.id);
    }
    if (req.type === 'hospital') {
      // Hospital owner can confirm/decline bookings
      return Number(req.bank_user_id) === Number(me?.id);
    }
    return false;
  }

  function canCancel(req) {
    // Requester can cancel their own request (subject to time window enforced by backend)
    const isMine = Number(req.requester_id) === Number(me?.id);
    if (!isMine) return false;
    if (req.type === 'inventory') {
      return req.status === 'pending' || req.status === 'accepted';
    }
    if (req.type === 'donor') {
      return req.status === 'pending' || req.status === 'accepted';
    }
    if (req.type === 'hospital') {
      return req.status === 'booked';
    }
    if (req.type === 'fire') {
      return req.status === 'pending';
    }
    return false;
  }

  return (
    <div className="bg-white p-6 rounded shadow mt-4">
      <h3 className="font-semibold mb-2">All Requests in This Crisis</h3>
      <div className="text-xs text-gray-600 mb-3">Everyone in this crisis can see requests. Relevant organizations or users can respond below.</div>
      {loading && page === 1 ? (
        <div>Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2">Type</th>
                <th>Requester</th>
                <th>Counterparty</th>
                <th>Blood/Qty</th>
                <th>Target</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan="7" className="py-3 text-gray-600">No requests yet.</td></tr>
              ) : items.map((r) => {
                const typeLabel = r.type === 'inventory' ? 'Blood Inventory' : (r.type === 'donor' ? 'Donor Meeting' : (r.type === 'hospital' ? 'Hospital Booking' : (r.type === 'fire' ? 'Fire Service' : r.type)));
                const counterparty = r.type === 'inventory'
                  ? (r.bank_user_id ? `Bank #${r.bank_user_id}` : '—')
                  : r.type === 'donor'
                    ? (r.donor_user_id ? `Donor #${r.donor_user_id}` : '—')
                    : r.type === 'hospital'
                      ? (r.bank_user_id ? `Hospital #${r.bank_user_id}` : '—')
                      : r.type === 'fire'
                        ? (r.assigned_department_id ? (r.assigned_department_name ? r.assigned_department_name : `Department #${r.assigned_department_id}`) : '—')
                        : '—';
                const bq = r.type === 'inventory' ? `${r.blood_type || '—'} × ${r.quantity_units || 0}` : (r.type === 'donor' ? (r.blood_type || '—') : (r.type === 'fire' ? (r.location_text || '—') : '—'));
                const when = r.target_datetime ? new Date(r.target_datetime).toLocaleString() : '';
                return (
                  <tr key={`${r.type}-${r.id}`} className="border-t">
                    <td className="py-2">{typeLabel}</td>
                    <td>{r.requester_name || r.requester_id || '—'}</td>
                    <td>{counterparty}</td>
                    <td>{bq}</td>
                    <td>{when}</td>
                    <td>{r.status}</td>
                    <td className="space-x-2">
                      {/* Fire service deploy controls */}
                      {r.type === 'fire' && r.status === 'pending' && isFireService && (
                        <span className="inline-flex items-center gap-2">
                          {/* Department is chosen automatically (owned or single). */}
                          <select
                            id={`deploy-team-${r.id}`}
                            className="px-1 py-1 border rounded text-xs bg-white"
                            defaultValue=""
                            disabled={deployBusy[r.id] || teamsLoading || !deployDeptId}
                          >
                            <option value="" disabled>{teamsLoading ? 'Loading teams...' : (deployDeptId ? 'Select team' : 'No department')}</option>
                            {(!teamsLoading && deployDeptId && teamsCache.length===0) && <option value="" disabled>No teams</option>}
                            {teamsCache.map(t => (
                              <option key={t.id} value={t.id}>{t.name || `Team ${t.id}`}</option>
                            ))}
                          </select>
                          <button type="button" className="px-1 py-1 text-xs border rounded" onClick={loadTeams} disabled={!deployDeptId || teamsLoading}>↻</button>
                          <button
                            type="button"
                            className="px-2 py-1 text-xs bg-indigo-600 text-white rounded"
                            disabled={deployBusy[r.id] || teamsLoading || !deployDeptId || teamsCache.length===0}
                            onClick={async () => {
                              const select = document.getElementById(`deploy-team-${r.id}`);
                              const team_id = select && select.value ? parseInt(select.value) : null;
                              if (!team_id) { setDeployMsg(m => ({ ...m, [r.id]: 'Pick a team' })); return; }
                              setDeployBusy(b => ({ ...b, [r.id]: true }));
                              setDeployMsg(m => ({ ...m, [r.id]: null }));
                              try {
                                await api.deployFireRequestTeam(r.id, team_id);
                                setDeployMsg(m => ({ ...m, [r.id]: 'Deployed' }));
                                // optimism: refresh list to reflect assignment
                                await loadPage(page);
                                window.dispatchEvent(new CustomEvent('fire-request-deployed', { detail: { request_id: r.id, team_id } }));
                              } catch (e) {
                                setDeployMsg(m => ({ ...m, [r.id]: e.message || 'Failed' }));
                              } finally {
                                setDeployBusy(b => ({ ...b, [r.id]: false }));
                                setTimeout(()=> setDeployMsg(m => { const n={...m}; delete n[r.id]; return n; }), 3000);
                              }
                            }}
                          >{deployBusy[r.id] ? '...' : 'Deploy'}</button>
                          {deployMsg[r.id] && <span className={`text-[10px] ${deployMsg[r.id]==='Deployed' ? 'text-emerald-700':'text-rose-600'}`}>{deployMsg[r.id]}</span>}
                          {!deployDeptId && <span className="text-[10px] text-amber-700">No department available. Create one in Fire Teams.</span>}
                          {deployDeptId && teamsCache.length===0 && !teamsLoading && <span className="text-[10px] text-gray-500">No teams yet. Create a team in Fire Teams.</span>}
                        </span>
                      )}
                      {r.type === 'inventory' && r.status === 'pending' && canAct(r, 'accepted') && (
                        <>
                          <button className="px-2 py-1 text-xs bg-emerald-600 text-white rounded" onClick={()=>act(r,'accepted')}>Accept</button>
                          <button className="px-2 py-1 text-xs bg-rose-600 text-white rounded" onClick={()=>act(r,'rejected')}>Reject</button>
                        </>
                      )}
                      {r.type === 'inventory' && r.status === 'accepted' && canAct(r, 'completed') && (
                        <button className="px-2 py-1 text-xs bg-indigo-600 text-white rounded" onClick={()=>act(r,'completed')}>Mark Completed</button>
                      )}
                      {r.type === 'inventory' && canCancel(r) && (
                        <button className="px-2 py-1 text-xs bg-gray-200 text-gray-900 rounded" onClick={()=>act(r,'cancelled')}>Cancel</button>
                      )}
                      {r.type === 'donor' && r.status === 'pending' && canAct(r, 'accepted') && (
                        <>
                          <button className="px-2 py-1 text-xs bg-emerald-600 text-white rounded" onClick={()=>act(r,'accepted')}>Accept</button>
                          <button className="px-2 py-1 text-xs bg-rose-600 text-white rounded" onClick={()=>act(r,'rejected')}>Reject</button>
                        </>
                      )}
                      {r.type === 'donor' && r.status === 'accepted' && canAct(r, 'completed') && (
                        <button className="px-2 py-1 text-xs bg-indigo-600 text-white rounded" onClick={()=>act(r,'completed')}>Mark Completed</button>
                      )}
                      {r.type === 'donor' && canCancel(r) && (
                        <button className="px-2 py-1 text-xs bg-gray-200 text-gray-900 rounded" onClick={()=>act(r,'cancelled')}>Cancel</button>
                      )}
                      {r.type === 'hospital' && canCancel(r) && (
                        <button className="px-2 py-1 text-xs bg-gray-200 text-gray-900 rounded" onClick={()=>act(r,'cancelled')}>Cancel</button>
                      )}
                      {r.type === 'hospital' && r.status === 'booked' && canAct(r, 'confirmed') && (
                        <>
                          <button className="px-2 py-1 text-xs bg-emerald-600 text-white rounded" onClick={()=>act(r,'confirmed')}>Confirm</button>
                          <button className="px-2 py-1 text-xs bg-rose-600 text-white rounded" onClick={()=>act(r,'declined')}>Decline</button>
                        </>
                      )}
                      {r.type === 'fire' && canCancel(r) && (
                        <button className="px-2 py-1 text-xs bg-gray-200 text-gray-900 rounded" onClick={()=>act(r,'cancelled')}>Cancel</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex items-center gap-3">
        {hasMore && (
          <button disabled={loading} onClick={()=>loadPage(page + 1)} className="text-xs text-indigo-700 disabled:opacity-50">{loading ? 'Loading…' : 'Load more'}</button>
        )}
        {!loading && items.length > 0 && (
          <button onClick={()=>loadPage(1)} className="text-xs text-gray-700">Refresh</button>
        )}
      </div>
      {msg && <div className={`mt-3 text-xs ${/failed|error|invalid|forbidden/i.test(msg)?'text-red-600':'text-emerald-700'}`}>{msg}</div>}
    </div>
  );
}


export default function CrisisDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [donAmount, setDonAmount] = useState('');
  const [donNote, setDonNote] = useState('');
  // Current user + role flags
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const isAdmin = !!(me && ((me.role||'').toLowerCase().includes('admin') || me.is_admin || me.isAdmin));
  const isClosed = (data?.status === 'closed' || data?.status === 'cancelled');
  const roleStr = String(me?.role || '').toLowerCase();
  const rolesList = Array.isArray(me?.roles) ? me.roles.map(r => String(r).toLowerCase()) : [];
  const isHospital = roleStr.includes('hospital') || rolesList.some(r => r.includes('hospital'));
  const isBloodBank = roleStr.includes('blood') || rolesList.some(r => r.includes('blood'));
  const isFireService = roleStr.includes('fire') || rolesList.some(r => r.includes('fire'));
  const isSocialOrg = roleStr.includes('social') || roleStr.includes('ngo') || rolesList.some(r => r.includes('social') || r.includes('ngo'));
  const isDonor = roleStr.includes('donor') || rolesList.some(r => r.includes('donor'));
  const isVolunteer = roleStr.includes('volunteer') || rolesList.some(r => r.includes('volunteer'));
  const isOrgOrVolunteer = isHospital || isBloodBank || isFireService || isSocialOrg || isDonor || isVolunteer;
  // Default join role aligns with the user's org role when possible
  const defaultJoinRole = (
    isHospital ? 'hospital'
    : isBloodBank ? 'blood_bank'
    : isFireService ? 'fire_service'
    : isSocialOrg ? 'social_org'
    : isDonor ? 'donor'
    : 'volunteer'
  );
  const [joinRole, setJoinRole] = useState(defaultJoinRole);
  const [showDonate, setShowDonate] = useState(false);
  const [invSearch, setInvSearch] = useState('');
  const [invResults, setInvResults] = useState([]);
  const [completedSummary, setCompletedSummary] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [deletingInviteId, setDeletingInviteId] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [myReq, setMyReq] = useState(null); // current user's participation request (if any)
  const [invites, setInvites] = useState([]);
  // Admin: participation requests
  const [pReqs, setPReqs] = useState([]);
  const [pReqLoading, setPReqLoading] = useState(false);
  const [pReqMsg, setPReqMsg] = useState('');
  const [pReqBusyId, setPReqBusyId] = useState(null);
  // Locally track decided IDs so they don't reappear on refresh if backend filtering differs
  const [decidedIds, setDecidedIds] = useState(new Set());
  // Consider user "active participant" if they appear in participants list for this incident
  const isActiveParticipant = useMemo(() => {
    try {
      const myId = Number(me?.id);
      if (!myId) return false;
      return Array.isArray(participants) && participants.some(p => Number(p.user_id) === myId);
    } catch { return false; }
  }, [participants, me]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await api.getCrisis(id);
        if (!mounted) return;
        setData(r);
        // Load participants for this incident for display (accepted/active only)
        try {
          const p = await api.request(`/incidents/${r.incident_id}/participants?with_users=1`);
          if (mounted) setParticipants((p && p.results) ? p.results : Array.isArray(p) ? p : []);
        } catch (e) { /* non-fatal */ }
        // Load my participation request status (for button state / badge)
        try {
          const mine = await api.request(`/crises/${id}/participation/mine`, 'GET', undefined, { suppressStatus: [404] });
          if (mounted && mine) setMyReq(mine);
        } catch (e) { /* ignore */ }
        // Load invitations (admin only)
        if (isAdmin) {
          try {
            const inv = await api.request(`/crises/${id}/invitations/list?with_users=1`, 'GET', undefined, { suppressStatus: [403] });
            if (mounted) setInvites(inv.results || []);
          } catch (e) { /* ignore for non-admins */ }
        }
        // If closed, load final summary
        try {
          if ((r.status === 'closed' || r.status === 'cancelled')) {
            const sum = await api.request(`/crises/${id}/completed/summary`, 'GET', undefined, { suppressStatus: [403,404] });
            if (mounted) setCompletedSummary(sum || null);
          } else {
            if (mounted) setCompletedSummary(null);
          }
        } catch {}
      } catch (e) {
        setError(e.message || 'Failed to load crisis');
      } finally {
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [id, isAdmin]);

  // Helper to refresh participants list on demand
  const refreshParticipants = useCallback(async () => {
    const incidentId = data?.incident_id;
    if (!incidentId) return;
    try {
      const p = await api.request(`/incidents/${incidentId}/participants?with_users=1`);
      setParticipants((p && p.results) ? p.results : Array.isArray(p) ? p : []);
    } catch (e) {
      /* ignore */
    }
  }, [data]);

  // Listen for a custom event to refresh participants (e.g., after approval or idempotent request)
  useEffect(() => {
    function onRefresh() { refreshParticipants(); }
    window.addEventListener('participants-refresh', onRefresh);
    return () => { window.removeEventListener('participants-refresh', onRefresh); };
  }, [refreshParticipants]);

  // Also support refreshing my request status on demand
  useEffect(() => {
    async function refreshMine() {
      try { const mine = await api.request(`/crises/${id}/participation/mine`, 'GET', undefined, { suppressStatus: [404] }); setMyReq(mine || null); } catch {}
    }
    function onMine() { refreshMine(); }
    window.addEventListener('mine-refresh', onMine);
    return () => { window.removeEventListener('mine-refresh', onMine); };
  }, [id]);

  // Load participation requests for admins
  const refreshParticipationRequests = useCallback(async () => {
    setPReqLoading(true); setPReqMsg('');
    try {
      const r = await api.crisisParticipationRequestsList(id, { status: 'pending', with_users: 1 });
      const listRaw = (r && Array.isArray(r.results)) ? r.results : (Array.isArray(r) ? r : []);
      // Keep only truly pending-like items; and exclude any locally-decided ones
      const list = (listRaw || []).filter(x => {
        const s = String(x.status || x.state || x.decision || '').toLowerCase();
        const isPending = !s || s === 'pending' || s === 'requested' || s === 'request' || s === 'new';
        const hiddenByLocal = decidedIds instanceof Set ? decidedIds.has(x.id) : false;
        return isPending && !hiddenByLocal;
      });
      setPReqs(list);
    } catch (e) {
      setPReqMsg(e.message || 'Failed to load participation requests');
    } finally {
      setPReqLoading(false);
    }
  }, [id, decidedIds]);

  useEffect(() => {
    if (!isAdmin) return;
    let mounted = true;
    (async () => { if (mounted) await refreshParticipationRequests(); })();
    return () => { mounted = false; };
  }, [isAdmin, refreshParticipationRequests]);

  async function decideParticipation(req, action) {
    setPReqMsg('');
    setPReqBusyId(req.id);
    const prevList = pReqs;
    // Optimistic removal
    setPReqs((list)=>Array.isArray(list)?list.filter(x=>x.id!==req.id):list);
    try {
      // Try multiple possible backend status keywords to avoid invalid_status
      const approveCandidates = ['accepted','approved','approve','accept'];
      const rejectCandidates = ['declined','rejected','reject','deny','denied'];
      const candidates = (action === 'approved' || action === 'approve') ? approveCandidates : rejectCandidates;
      let lastErr = null; let ok = false;
      for (const s of candidates) {
        try {
          await api.crisisParticipationRequestDecide(id, req.id, s);
          ok = true; break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!ok) throw lastErr || new Error('Failed to update request');
      // Refresh participants (requests list already updated optimistically)
      const p = data?.incident_id ? await api.request(`/incidents/${data.incident_id}/participants?with_users=1`) : null;
      if (p) setParticipants((p && p.results) ? p.results : Array.isArray(p) ? p : []);
      // Mark as decided locally so even manual refresh won't bring it back this session
      setDecidedIds(prev => {
        const next = new Set(prev instanceof Set ? Array.from(prev) : []);
        next.add(req.id);
        return next;
      });
      const msg = (action === 'approved' || action === 'approve') ? 'Request approved' : 'Request rejected';
      setPReqMsg(msg);
      try { window.dispatchEvent(new CustomEvent('api-toast', { detail: { message: msg } })); } catch {}
    } catch (e) {
      setPReqMsg(e.message || 'Failed to update request');
      // Revert optimistic removal on failure
      setPReqs(prevList);
    } finally {
      setPReqBusyId(null);
    }
  }

  async function donate() {
    const amt = parseFloat(donAmount);
    if (!amt || amt <= 0) return;
    try {
      await api.crisisAddDonation(id, amt, donNote || null);
      const r = await api.getCrisis(id);
      setData(r);
      setDonAmount(''); setDonNote('');
    } catch (e) {
      setError(e.message || 'Donation failed');
    }
  }

  async function join() {
    try {
      await api.crisisJoin(id, joinRole);
      const r = await api.getCrisis(id);
      setData(r);
      // Refresh participants after join
      try {
  const p = await api.request(`/incidents/${r.incident_id}/participants?with_users=1`);
        setParticipants((p && p.results) ? p.results : Array.isArray(p) ? p : []);
      } catch {}
    } catch (e) {
      setError(e.message || 'Join failed');
    }
  }

  async function searchUsers() {
    try {
      const r = await api.searchUsers(invSearch);
      setInvResults(r.results || []);
    } catch (e) {}
  }

  async function invite(org) {
    setInviting(true);
    try {
      const role = (org.role || '').toLowerCase();
      // Normalize incoming user.role to the canonical org_type we store in invitations
      const roleMap = {
        'hospital': 'hospital',
        'blood_bank': 'blood_bank',
        'bloodbank': 'blood_bank',
        'fire_department': 'fire_service',
        'fire_dept': 'fire_service',
        'fire_service': 'fire_service',
        'org': 'social_org',
        'ngo': 'social_org',
        'social_service': 'social_org',
        'social_org': 'social_org',
      };
      const type = roleMap[role] || 'social_org';
      await api.crisisInvite(id, org.id, type, null);
      alert('Invitation sent');
      try {
        const inv = await api.request(`/crises/${id}/invitations/list?with_users=1`);
        setInvites(inv.results || []);
      } catch {}
    } catch (e) {
      setError(e.message || 'Invite failed');
    } finally {
      setInviting(false);
    }
  }

  if (loading) return <div>Loading…</div>;
  if (error) return <div className="text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded shadow">
        <h2 className="text-xl font-semibold mb-4">{data.title}</h2>
        <div className="space-y-2">
          <Field label="Status">{data.status}</Field>
          <Field label="Type/Severity">{data.incident_type} / {data.severity || 'n/a'}</Field>
          <Field label="Location">{data.lat != null ? `${data.lat}, ${data.lng}` : 'n/a'}</Field>
          <Field label="Radius">{data.radius_km ?? '—'} km</Field>
          <Field label="Participants">{data.participant_count}</Field>
          <Field label="Funds">BDT {data.donations_total?.toFixed ? data.donations_total.toFixed(2) : data.donations_total} (spent {data.expenses_total}) • Balance {data.balance}</Field>
        </div>
        {/* Action buttons row */}
  <div className="mt-4 flex flex-wrap gap-2 items-center">
          {isClosed && (
            <span className="text-xs px-2 py-1 rounded bg-gray-200 text-gray-700">This crisis is completed. Actions are disabled; view final summary below.</span>
          )}
          {/* Show exactly one of: Enroll as Victim (regular users) OR Request to Participate (orgs/volunteers). Join (instant) is admin-only. */}
          {!isClosed && !isAdmin && !isActiveParticipant && (
            data.is_victim ? null : (
              isOrgOrVolunteer ? (
                <>
                  <RequestParticipateButton id={id} roleLabel={joinRole || 'volunteer'} disabled={/pending|requested|new/i.test(String(myReq?.status||'')) || isActiveParticipant} />
                  {/pending|requested|new/i.test(String(myReq?.status||'')) && (
                    <span className="ml-2 text-xs px-2 py-1 rounded bg-amber-100 text-amber-800">Requested — awaiting approval</span>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="px-3 py-2 bg-emerald-600 text-white rounded"
                    disabled={/pending|requested|new/i.test(String(myReq?.status||'')) || isActiveParticipant}
                    onClick={join}
                  >Join as Volunteer</button>
                  <button
                    className="px-3 py-2 bg-rose-600 text-white rounded"
                    onClick={async ()=>{
                      try { await api.crisisVictimsEnroll(id); window.location.reload(); } catch(e){
                        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to enroll' } }));
                      }
                    }}
                  >Enroll as Victim</button>
                </>
              )
            )
          )}
          {/* Donate quick action */}
          {!isClosed && (
          <button
            className="px-3 py-2 bg-indigo-600 text-white rounded"
            onClick={()=> setShowDonate(true)}
          >Donate</button>
          )}
          {/* Leave crisis: anyone can remove themselves (participant and/or victim) */}
          {!isClosed && (
            <button
              className="px-3 py-2 bg-gray-200 text-gray-800 rounded"
              onClick={async ()=>{
                if (!window.confirm('Leave this crisis? You will be removed as participant and/or unenrolled as victim.')) return;
                try {
                  await api.crisisLeave(id);
                  // Refresh crisis + participants; also clear any pending request badge locally
                  try {
                    const r = await api.getCrisis(id);
                    setData(r);
                    const p = await api.request(`/incidents/${r.incident_id}/participants?with_users=1`);
                    setParticipants((p && p.results) ? p.results : Array.isArray(p) ? p : []);
                  } catch {}
                  setMyReq(null);
                } catch(e) {
                  window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to leave' } }));
                }
              }}
            >Leave</button>
          )}
          {/* Admin: complete crisis (close incident) */}
          {isAdmin && !isClosed && (
            <button
              className="px-3 py-2 bg-gray-800 text-white rounded"
              onClick={async ()=>{
                if (!window.confirm('Mark this crisis as completed? This will close the incident.')) return;
                try { await api.request(`/incidents/${data.incident_id}/status`, 'POST', { status: 'closed' }); window.location.reload(); }
                catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to complete crisis' } })); }
              }}
            >Complete Crisis</button>
          )}
        </div>

        {/* Donate modal */}
        {showDonate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={()=>setShowDonate(false)} />
            <div className="relative bg-white rounded shadow-lg w-[90%] max-w-md p-5">
              <div className="text-lg font-semibold mb-3">Donate to {data.title}</div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm">Amount (BDT)</label>
                  <input type="number" min="1" step="0.01" value={donAmount} onChange={(e)=>setDonAmount(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
                </div>
                <div>
                  <label className="block text-sm">Note (optional)</label>
                  <input value={donNote} onChange={(e)=>setDonNote(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
                </div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="px-3 py-2 text-gray-700" onClick={()=>setShowDonate(false)}>Cancel</button>
                <button className="px-3 py-2 bg-indigo-600 text-white rounded" onClick={async ()=>{ await donate(); setShowDonate(false); }}>Donate</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {isClosed && (
        <div className="bg-white p-6 rounded shadow">
          <h3 className="font-semibold mb-2">Final Report</h3>
          {!completedSummary ? (
            <div className="text-sm text-gray-600">Summary not available.</div>
          ) : (
            <div className="space-y-3 text-sm">
              <div>Victims: {Array.isArray(completedSummary.victims)?completedSummary.victims.length:0}</div>
              <div>Inventory Requests: {Array.isArray(completedSummary.inventory_requests)?completedSummary.inventory_requests.length:0}</div>
              <div>Donor Meetings: {Array.isArray(completedSummary.donor_meetings)?completedSummary.donor_meetings.length:0}</div>
              <div>Hospital Bookings: {Array.isArray(completedSummary.hospital_bookings)?completedSummary.hospital_bookings.length:0}</div>
              <div className="mt-3">
                <div className="font-medium">Latest Incident Events</div>
                <ul className="list-disc pl-5">
                  {(completedSummary.incident_events||[]).slice(0,10).map(e => (
                    <li key={e.id}>{new Date(e.created_at).toLocaleString()} — {e.event_type}{e.note?`: ${e.note}`:''}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="bg-white p-6 rounded shadow">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Participation Requests</h3>
            <button disabled={pReqLoading} onClick={refreshParticipationRequests} className="text-xs text-indigo-700 disabled:opacity-50">{pReqLoading ? 'Refreshing…' : 'Refresh'}</button>
          </div>
          {pReqLoading ? (
            <div>Loading…</div>
          ) : !pReqs.length ? (
            <div className="text-sm text-gray-600">No pending participation requests.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2">User</th>
                    <th>Role</th>
                    <th>Note</th>
                    <th>When</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pReqs.map(r => {
                    const name = r.user_name || r.requester_name || null;
                    const email = r.user_email || r.requester_email || null;
                    const who = name || (email ? email.split('@')[0] : `User #${r.user_id || r.requester_user_id || r.id}`);
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="py-2">
                          <div className="truncate">
                            <div className="font-medium">{who}</div>
                            <div className="text-xs text-gray-600">{email || ''}</div>
                          </div>
                        </td>
                        <td>{r.role_label || r.role || '—'}</td>
                        <td className="max-w-[28rem] truncate" title={r.note || ''}>{r.note || ''}</td>
                        <td>{r.created_at ? new Date(r.created_at).toLocaleString() : ''}</td>
                        <td className="space-x-2">
                          <button disabled={pReqBusyId===r.id} className="px-2 py-1 text-xs bg-emerald-600 text-white rounded disabled:opacity-50" onClick={()=>decideParticipation(r, 'approved')}>{pReqBusyId===r.id?'…':'Approve'}</button>
                          <button disabled={pReqBusyId===r.id} className="px-2 py-1 text-xs bg-rose-600 text-white rounded disabled:opacity-50" onClick={()=>decideParticipation(r, 'rejected')}>{pReqBusyId===r.id?'…':'Reject'}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {pReqMsg && <div className={`mt-3 text-xs ${/failed|error|invalid|forbidden/i.test(pReqMsg)?'text-red-600':'text-emerald-700'}`}>{pReqMsg}</div>}
        </div>
      )}

      <div className="bg-white p-6 rounded shadow">
        <h3 className="font-semibold mb-2">Participants</h3>
        {!participants.length ? (
          <div className="text-sm text-gray-600">No active participants yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2">User</th>
                <th>Role</th>
                <th>Since</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {participants.map(p => (
                <tr key={p.id} className="border-t">
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      {p.avatar_url ? (<img src={p.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover border" />) : (
                        <div className="w-6 h-6 rounded-full bg-gray-200" />
                      )}
                      <span>{p.user_name || `#${p.user_id}`}</span>
                    </div>
                  </td>
                  <td>{p.role_label || 'participant'}</td>
                  <td>{p.joined_at ? new Date(p.joined_at).toLocaleString() : ''}</td>
                  {isAdmin && (
                    <td>
                      <button
                        disabled={removingId===p.id}
                        onClick={async ()=>{
                          if (!window.confirm('Remove this participant?')) return;
                          setRemovingId(p.id);
                          try {
                            await api.deleteIncidentParticipant(data.incident_id, p.id);
                            const resp = await api.request(`/incidents/${data.incident_id}/participants?with_users=1`);
                            setParticipants((resp && resp.results) ? resp.results : Array.isArray(resp) ? resp : []);
                          } catch(e){
                            window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to remove' } }));
                          } finally { setRemovingId(null); }
                        }}
                        className="px-2 py-1 text-xs bg-rose-600 text-white rounded disabled:opacity-50"
                      >{removingId===p.id ? 'Removing…' : 'Remove'}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Victim-side: request services from enlisted organizations */}
      {/* Victim-only panel: only users enrolled as victims can request services */}
      {data.is_victim ? (
        <VictimServicesPanel crisis={data} participants={participants} />
      ) : null}

      {isAdmin && (
        <div className="bg-white p-6 rounded shadow">
          <h3 className="font-semibold mb-2">Participate (Admin quick add)</h3>
          <div className="flex gap-2 items-end">
            <div>
              <label className="text-sm block">Role Label</label>
              <input value={joinRole} onChange={(e)=>setJoinRole(e.target.value)} className="border rounded px-3 py-2" />
            </div>
            <button onClick={join} className="px-4 py-2 bg-emerald-600 text-white rounded">Join</button>
          </div>
        </div>
      )}

      <div className="bg-white p-6 rounded shadow">
        <h3 className="font-semibold mb-2">Donate to Crisis</h3>
        <div className="flex items-end gap-2">
          <div>
            <label className="text-sm block">Amount</label>
            <input type="number" min="1" step="0.01" value={donAmount} onChange={(e)=>setDonAmount(e.target.value)} className="border rounded px-3 py-2" />
          </div>
          <div className="flex-1">
            <label className="text-sm block">Note (optional)</label>
            <input value={donNote} onChange={(e)=>setDonNote(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <button onClick={donate} className="px-4 py-2 bg-indigo-600 text-white rounded">Donate</button>
        </div>
      </div>

      {isAdmin && (
      <div className="bg-white p-6 rounded shadow">
        <h3 className="font-semibold mb-2">Invite Organizations (Admin)</h3>
        <div className="flex gap-2 mb-2">
          <input value={invSearch} onChange={(e)=>setInvSearch(e.target.value)} placeholder="Search users/orgs by name or email" className="flex-1 border rounded px-3 py-2" />
          <button onClick={searchUsers} className="px-4 py-2 bg-gray-800 text-white rounded">Search</button>
        </div>
        {!!invites.length && (
          <div className="mb-3">
            <div className="font-medium mb-1">Sent Invitations</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2">Org User</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Sent</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map(iv => (
                  <tr key={iv.id} className="border-t">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        {iv.org_user_avatar_url ? (<img src={iv.org_user_avatar_url} alt="" className="w-6 h-6 rounded-full object-cover border" />) : (<div className="w-6 h-6 rounded-full bg-gray-200" />)}
                        <span>{iv.org_user_name || iv.org_user_email || `#${iv.org_user_id}`}</span>
                      </div>
                    </td>
                    <td>{iv.org_type}</td>
                    <td>{iv.status}</td>
                    <td>{iv.created_at ? new Date(iv.created_at).toLocaleString() : ''}</td>
                    <td>
                      <button
                        disabled={deletingInviteId===iv.id}
                        onClick={async ()=>{
                          if (!window.confirm('Delete this invitation?')) return;
                          setDeletingInviteId(iv.id);
                          try {
                            await api.deleteCrisisInvitation(id, iv.id);
                            const inv = await api.request(`/crises/${id}/invitations/list?with_users=1`);
                            setInvites(inv.results || []);
                          } catch(e){
                            window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to delete' } }));
                          } finally { setDeletingInviteId(null); }
                        }}
                        className="px-2 py-1 text-xs bg-gray-700 text-white rounded disabled:opacity-50"
                      >{deletingInviteId===iv.id ? 'Deleting…' : 'Delete'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="divide-y">
          {invResults.map(u => (
            <div key={u.id} className="py-2 flex items-center justify-between">
              <div>
                <div className="font-medium">{u.full_name || u.name || u.email}</div>
                <div className="text-sm text-gray-600">{u.email} • {u.role}</div>
              </div>
              <button disabled={inviting} onClick={()=>invite(u)} className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50">Invite</button>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Requests Overview (admin/org only; volunteers should not see this) */}
      {(isAdmin || isBloodBank || isDonor) && (
        // getCrisis returns `crisis_id` alongside incident_id; prefer that for scoping
        <RequestsOverview crisisId={data.crisis_id || id} isAdmin={isAdmin} isBloodBank={isBloodBank} isDonor={isDonor} />
      )}

      {/* All participants can see all victim requests within this crisis */}
  <AllRequestsPanel crisisId={data.crisis_id || id} isAdmin={isAdmin} isBloodBank={isBloodBank} isDonor={isDonor} isFireService={isFireService} />

      {/* Organization action updates panel (visible to org roles, not admin-only) */}
      <OrgActionPanel
        crisis={data}
        isHospital={isHospital}
        isBloodBank={isBloodBank}
        isFireService={isFireService}
        isSocialOrg={isSocialOrg}
        isAdmin={isAdmin}
        isActiveParticipant={isActiveParticipant}
        onAfterSubmit={async ()=>{
          // refresh participants subtly after an org posts an update, in case roles changed
          try {
            const p = await api.request(`/incidents/${data.incident_id}/participants?with_users=1`);
            setParticipants((p && p.results) ? p.results : Array.isArray(p) ? p : []);
          } catch {}
        }}
      />

      {/* Hospital-only structured resources CRUD panel (requires active participation) */}
      {isHospital && (
        isActiveParticipant ? (
          <HospitalCrisisResourcesPanel incidentId={data.incident_id} />
        ) : (
          <div className="bg-white p-6 rounded shadow">
            <h3 className="font-semibold mb-2">Hospital: Crisis Capacity & Services</h3>
            <div className="text-sm text-gray-700">You need to be approved as a participant in this crisis to manage hospital resources. Ask an admin to approve your participation request or accept an invitation.</div>
          </div>
        )
      )}

      {/* Public activity timeline for the crisis */}
      <CrisisActivity incidentId={data.incident_id} />
      <div className="mt-4">
        <FireServiceDeploymentPanel incidentId={data.incident_id} />
      </div>
      <div className="mt-4">
        <SocialVolunteerDeploymentPanel incidentId={data.incident_id} />
      </div>

      {/* Blood bank crisis support panel should appear above Finance & Transparency */}
      {isBloodBank && (
        isActiveParticipant ? (
          <BloodBankCrisisPanel crisisId={id} />
        ) : (
          <div className="bg-white p-6 rounded shadow">
            <h3 className="font-semibold mb-2">Blood Bank: Crisis Support</h3>
            <div className="text-sm text-gray-700">Your account is a Blood Bank, but you must be approved as a participant in this crisis before you can link donors or allocate inventory. Ask an admin to approve your participation request, or accept an invitation.</div>
          </div>
        )
      )}

      <CrisisTransparency id={id} isAdmin={isAdmin} />
  <VictimsPanel id={id} isAdmin={isAdmin} isActiveParticipant={isActiveParticipant} />
      <PotentialVictims id={id} />
    </div>
  );
}

function RequestsOverview({ crisisId, isAdmin, isBloodBank, isDonor }) {
  const [tab, setTab] = useState(isAdmin ? 'inventory' : (isBloodBank ? 'inventory' : 'donor'));
  const [invRequests, setInvRequests] = useState([]);
  const [donorRequests, setDonorRequests] = useState([]);
  const [invOutsideCount, setInvOutsideCount] = useState(0);
  const [donorOutsideCount, setDonorOutsideCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const me = JSON.parse(localStorage.getItem('me') || 'null');

  const load = useCallback(async () => {
    setLoading(true); setMsg('');
    try {
      const calls = [];
      if (isAdmin || isBloodBank) {
        if (isAdmin) {
          calls.push(api.listInventoryRequests({ crisis_id: crisisId, all: 1 }));
        } else {
          calls.push(api.listInventoryRequests({ bank_user_id: me?.id, crisis_id: crisisId }));
        }
      }
      if (isAdmin || isDonor) {
        if (isAdmin) {
          calls.push(api.listDonorMeetingRequests({ crisis_id: crisisId, all: 1 }));
        } else {
          calls.push(api.listDonorMeetingRequests({ donor_user_id: me?.id, crisis_id: crisisId }));
        }
      }
      const results = await Promise.all(calls);
      let idx = 0;
      let invRes = [];
      let donorRes = [];
      if (isAdmin || isBloodBank) { invRes = results[idx++]?.results || []; setInvRequests(invRes); }
      if (isAdmin || isDonor) { donorRes = results[idx++]?.results || []; setDonorRequests(donorRes); }
      // Admin diagnostics: if nothing found scoped to this crisis, see if anything exists outside
      if (isAdmin) {
        if ((isAdmin || isBloodBank) && invRes.length === 0) {
          try {
            const allInv = await api.listInventoryRequests({ all: 1 });
            setInvOutsideCount((allInv?.results || []).length);
          } catch {}
        } else {
          setInvOutsideCount(0);
        }
        if ((isAdmin || isDonor) && donorRes.length === 0) {
          try {
            const allDon = await api.listDonorMeetingRequests({ all: 1 });
            setDonorOutsideCount((allDon?.results || []).length);
          } catch {}
        } else {
          setDonorOutsideCount(0);
        }
      }
    } catch (e) { setMsg(e.message || 'Failed to load'); }
    setLoading(false);
  }, [isAdmin, isBloodBank, isDonor, me?.id, crisisId]);

  useEffect(() => { load(); }, [load]);

  // Refresh automatically when new requests are created elsewhere on the page
  useEffect(() => {
    function onUpdated() { load(); }
    window.addEventListener('requests-updated', onUpdated);
    return () => { window.removeEventListener('requests-updated', onUpdated); };
  }, [load]);

  async function actInventory(req, status) {
    try {
      const extra = {};
      if (status === 'rejected' && !window.confirm('Reject this request?')) return;
      await api.updateInventoryRequestStatus(req.id, status, extra);
      await load();
    } catch (e) { setMsg(e.message || 'Failed'); }
  }
  async function actDonor(req, status) {
    try {
      const extra = {};
      if (status === 'rejected' && !window.confirm('Reject this donor meeting?')) return;
      if (status === 'completed') {
        const cd = window.prompt('Cooldown days after completion (optional, 0 to skip)', '10');
        if (cd != null && cd !== '') extra.cooldown_days = parseInt(cd, 10) || 0;
      }
      await api.updateDonorMeetingRequestStatus(req.id, status, extra);
      await load();
    } catch (e) { setMsg(e.message || 'Failed'); }
  }

  return (
    <div id="requests" className="bg-white p-6 rounded shadow">
      <h3 className="font-semibold mb-2">Requests Overview</h3>
      <div className="text-xs text-gray-600 mb-3">
        Admins can see all requests. Organizations see requests relevant to them and can respond.
        {isAdmin && (invOutsideCount > 0 || donorOutsideCount > 0) && (
          <>
            <br />
            <span className="text-[11px] text-amber-700">
              Tip: Found {invOutsideCount} inventory and {donorOutsideCount} donor requests outside this crisis. If you expected items here, make sure creation includes crisis_id.
            </span>
          </>
        )}
      </div>
      <div className="flex gap-2 mb-3">
        {(isAdmin || isBloodBank) && (
          <button onClick={()=>setTab('inventory')} className={`px-3 py-1 rounded ${tab==='inventory'?'bg-indigo-600 text-white':'bg-gray-100'}`}>Blood Inventory</button>
        )}
        {(isAdmin || isDonor) && (
          <button onClick={()=>setTab('donor')} className={`px-3 py-1 rounded ${tab==='donor'?'bg-indigo-600 text-white':'bg-gray-100'}`}>Donor Meetings</button>
        )}
      </div>
      {loading ? <div>Loading…</div> : (
        <>
          {tab==='inventory' && (
            !invRequests.length ? (
              <div className="text-sm text-gray-600">No requests.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2">Requester</th>
                    <th>Bank</th>
                    <th>Blood/Qty</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invRequests.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className="py-2">{r.requester_name || r.requester_user_id}</td>
                      <td>{r.bank_user_id}</td>
                      <td>{r.blood_type} × {r.quantity_units}</td>
                      <td>{r.target_datetime ? new Date(r.target_datetime).toLocaleString() : ''}</td>
                      <td>{r.status}</td>
                      <td className="space-x-2">
                        {r.status==='pending' && (isAdmin || (isBloodBank && Number(r.bank_user_id)===Number(me?.id))) && (
                          <>
                            <button className="px-2 py-1 text-xs bg-emerald-600 text-white rounded" onClick={()=>actInventory(r,'accepted')}>Accept</button>
                            <button className="px-2 py-1 text-xs bg-rose-600 text-white rounded" onClick={()=>actInventory(r,'rejected')}>Reject</button>
                          </>
                        )}
                        {r.status==='accepted' && (isAdmin || (isBloodBank && Number(r.bank_user_id)===Number(me?.id))) && (
                          <button className="px-2 py-1 text-xs bg-indigo-600 text-white rounded" onClick={()=>actInventory(r,'completed')}>Mark Completed</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
          {tab==='donor' && (
            !donorRequests.length ? (
              <div className="text-sm text-gray-600">No requests.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2">Requester</th>
                    <th>Donor</th>
                    <th>Blood</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {donorRequests.map(r => (
                    <tr key={r.id} className="border-t">
                      <td className="py-2">{r.requester_name || r.requester_user_id}</td>
                      <td>{r.donor_user_id}</td>
                      <td>{r.blood_type || '—'}</td>
                      <td>{r.target_datetime ? new Date(r.target_datetime).toLocaleString() : ''}</td>
                      <td>{r.status}</td>
                      <td className="space-x-2">
                        {r.status==='pending' && (isAdmin || (isDonor && Number(r.donor_user_id)===Number(me?.id))) && (
                          <>
                            <button className="px-2 py-1 text-xs bg-emerald-600 text-white rounded" onClick={()=>actDonor(r,'accepted')}>Accept</button>
                            <button className="px-2 py-1 text-xs bg-rose-600 text-white rounded" onClick={()=>actDonor(r,'rejected')}>Reject</button>
                          </>
                        )}
                        {r.status==='accepted' && (isAdmin || (isDonor && Number(r.donor_user_id)===Number(me?.id))) && (
                          <button className="px-2 py-1 text-xs bg-indigo-600 text-white rounded" onClick={()=>actDonor(r,'completed')}>Mark Completed</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}
        </>
      )}
      {msg && <div className={`mt-3 text-xs ${/failed|error|invalid|forbidden/i.test(msg)?'text-red-600':'text-emerald-700'}`}>{msg}</div>}
    </div>
  );
}

function CrisisTransparency({ id, isAdmin }) {
  const [finance, setFinance] = useState(null);
  const [donations, setDonations] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [donPage, setDonPage] = useState(1);
  const [expPage, setExpPage] = useState(1);
  const pageSize = 10;
  const [donHasMore, setDonHasMore] = useState(true);
  const [expHasMore, setExpHasMore] = useState(true);
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expensePurpose, setExpensePurpose] = useState('');
  const [usersById, setUsersById] = useState({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [f, d, e] = await Promise.all([
          api.crisisFinanceSummary(id),
          api.crisisListDonations(id, { page: 1, page_size: pageSize, with_users: 1 }),
          api.crisisListExpenses(id, { page: 1, page_size: pageSize }),
        ]);
        if (!mounted) return;
        setFinance(f);
        setDonations(d.results || []);
        setExpenses(e.results || []);
        setDonPage(1); setExpPage(1);
        setDonHasMore((d.next_page || 0) > 1 || (d.total || 0) > (d.results || []).length);
        setExpHasMore((e.next_page || 0) > 1 || (e.total || 0) > (e.results || []).length);
      } catch (e) {}
    })();
    return () => { mounted = false; };
  }, [id]);

  async function loadMoreDonations() {
    const next = donPage + 1;
    const d = await api.crisisListDonations(id, { page: next, page_size: pageSize, with_users: 1 });
    const items = d.results || [];
    setDonations(prev => prev.concat(items));
    setDonPage(next);
    setDonHasMore((d.next_page || 0) > next || (d.total || 0) > (next * pageSize));
  }
  // Fetch display names/emails for any donor user IDs we don't have yet
  useEffect(() => {
    const donorIds = (donations || []).map(d => d.user_id ?? d.donor_user_id ?? d.created_by_user_id ?? (d.user && (d.user.id ?? d.user.user_id)) ?? null);
    const uniqueIds = Array.from(new Set(donorIds.filter(Boolean)));
    const need = uniqueIds.filter(uid => !usersById[uid]);
    if (need.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const chunk = need.slice(0, 50); // safety cap
        const results = await Promise.all(chunk.map(uid => api.getUserPublic(uid).catch(()=>null)));
        if (cancelled) return;
        const entries = {};
        results.forEach((u, idx) => {
          const uid = chunk[idx];
          if (u && (u.id || u.user_id)) entries[uid] = u;
        });
        if (Object.keys(entries).length) setUsersById(prev => ({ ...prev, ...entries }));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [donations, usersById]);

  async function loadMoreExpenses() {
    const next = expPage + 1;
    const e = await api.crisisListExpenses(id, { page: next, page_size: pageSize });
    const items = e.results || [];
    setExpenses(prev => prev.concat(items));
    setExpPage(next);
    setExpHasMore((e.next_page || 0) > next || (e.total || 0) > (next * pageSize));
  }

  return (
    <div className="bg-white p-6 rounded shadow">
      <h3 className="font-semibold mb-2">Finance & Transparency</h3>
      {finance && (
        <div className="text-sm text-gray-700 mb-3">Donations: {finance.donations_total} • Expenses: {finance.expenses_total} • Balance: {finance.balance}</div>
      )}
      {isAdmin && (
        <div className="mb-4 p-3 bg-gray-50 rounded border">
          <div className="font-medium mb-2">Add Expense (Admin)</div>
          <div className="flex items-end gap-2">
            <div>
              <label className="text-sm block">Amount</label>
              <input type="number" min="1" step="0.01" value={expenseAmount} onChange={(e)=>setExpenseAmount(e.target.value)} className="border rounded px-3 py-2" />
            </div>
            <div className="flex-1">
              <label className="text-sm block">Purpose</label>
              <input value={expensePurpose} onChange={(e)=>setExpensePurpose(e.target.value)} className="w-full border rounded px-3 py-2" />
            </div>
            <button onClick={async ()=>{
              const amt = parseFloat(expenseAmount);
              if (!amt || amt <= 0) return;
              try {
                await api.crisisAddExpense(id, amt, expensePurpose || null);
                const [f, e] = await Promise.all([
                  api.crisisFinanceSummary(id),
                  api.crisisListExpenses(id, { page: 1, page_size: pageSize }),
                ]);
                setFinance(f);
                setExpenses(e.results || []);
                setExpPage(1);
                setExpHasMore((e.next_page || 0) > 1 || (e.total || 0) > (e.results || []).length);
                setExpenseAmount(''); setExpensePurpose('');
              } catch (err) {
                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to add expense' } }));
              }
            }} className="px-4 py-2 bg-red-600 text-white rounded">Add Expense</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <div className="font-medium mb-1">Recent Donations</div>
          <ul className="text-sm list-disc pl-5">
            {donations.map(d => {
              const uid = d.user_id ?? d.donor_user_id ?? d.created_by_user_id ?? (d.user && (d.user.id ?? d.user.user_id)) ?? null;
              const fromUsers = uid ? (usersById[uid]?.full_name || usersById[uid]?.email) : null;
              const who = fromUsers || d.user_full_name || d.full_name || d.user_name || d.name || d.username || d.user_email || d.email || d.donor_name || (uid ? `User #${uid}` : 'Anonymous');
              const ts = d.created_at || d.timestamp || d.created || d.added_at || null;
              const when = ts ? new Date(ts).toLocaleString() : '';
              const amount = Number(d.amount);
              const currency = d.currency || 'BDT';
              return (
                <li key={d.id}>{currency} {amount.toLocaleString()} by {who}{when ? ` on ${when}` : ''}</li>
              );
            })}
          </ul>
          {donHasMore && (
            <button onClick={loadMoreDonations} className="mt-2 text-xs text-indigo-700">Load more</button>
          )}
        </div>
        <div>
          <div className="font-medium mb-1">Recent Expenses</div>
          <ul className="text-sm list-disc pl-5">
            {expenses.map(e => (
              <li key={e.id}>BDT {e.amount} for {e.purpose || 'N/A'} on {new Date(e.created_at).toLocaleString()}</li>
            ))}
          </ul>
          {expHasMore && (
            <button onClick={loadMoreExpenses} className="mt-2 text-xs text-indigo-700">Load more</button>
          )}
        </div>
      </div>
    </div>
  );
}

function VictimServicesPanel({ crisis, participants }) {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const isClosed = (crisis?.status === 'closed' || crisis?.status === 'cancelled');
  const [geo, setGeo] = useState({ lat: null, lng: null, loading: false, error: '' });
  const [msg, setMsg] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [svcTab, setSvcTab] = useState('hospital'); // 'hospital' | 'blood' | 'fire' | 'my'

  // Derived enlisted orgs by role label heuristics
  const hospitals = useMemo(() => (Array.isArray(participants) ? participants.filter(p => /hospital/i.test(String(p.role_label||''))) : []), [participants]);
  const bloodBanks = useMemo(() => (Array.isArray(participants) ? participants.filter(p => /(blood|blood_bank)/i.test(String(p.role_label||''))) : []), [participants]);
  const fireServices = useMemo(() => (Array.isArray(participants) ? participants.filter(p => /fire/i.test(String(p.role_label||''))) : []), [participants]);

  // Hospital resources (beds/services/doctors) per incident
  const [hospitalResources, setHospitalResources] = useState([]);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Prefer admin list with user enrichment; fall back to public/participant view.
        // Suppress the 403 toast on the first attempt because non-admins are expected to hit it.
        let res;
        try {
          const q = new URLSearchParams({ with_users: 1 }).toString();
          res = await api.request(`/incidents/${crisis.incident_id}/hospital/resources/list?${q}`, 'GET', undefined, { suppressStatus: [403] });
        } catch (e) {
          res = await api.listIncidentHospitalResourcesPublic(crisis.incident_id);
        }
        if (!mounted) return;
        setHospitalResources(res.results || []);
      } catch {}
    })();
    return () => { mounted = false; };
  }, [crisis.incident_id]);

  // Per-hospital services cache
  const [servicesByHospital, setServicesByHospital] = useState({});
  const ensureHospitalServices = useCallback(async (hospital_user_id) => {
    if (!hospital_user_id) return [];
    if (servicesByHospital[hospital_user_id]) return servicesByHospital[hospital_user_id];
    try {
      const s = await api.listHospitalServices(hospital_user_id);
      const list = (s?.results || s || []).map(x => ({ id: x.id, name: x.name || x.service_name || x.title || `Service #${x.id}` }));
      setServicesByHospital(prev => ({ ...prev, [hospital_user_id]: list }));
      return list;
    } catch { return []; }
  }, [servicesByHospital]);

  async function getLocation() {
    setGeo(g => ({ ...g, loading: true, error: '' }));
    try {
      const result = await new Promise((resolve) => {
        if (!navigator.geolocation) {
          setGeo(g => ({ ...g, loading: false, error: 'Geolocation unavailable' }));
          return resolve({ lat: null, lng: null });
        }
        navigator.geolocation.getCurrentPosition((pos) => {
          const { latitude, longitude } = pos.coords || {};
          if (typeof latitude === 'number' && typeof longitude === 'number') {
            setGeo({ lat: latitude, lng: longitude, loading: false, error: '' });
            resolve({ lat: latitude, lng: longitude });
          } else {
            setGeo(g => ({ ...g, loading: false, error: 'Could not read coordinates' }));
            resolve({ lat: null, lng: null });
          }
        }, (err) => { setGeo(g => ({ ...g, loading: false, error: err?.message || 'Location denied' })); resolve({ lat: null, lng: null }); }, { enableHighAccuracy: true, timeout: 7000 });
      });
      return result;
    } finally {}
  }

  // Zero-input quick booking: Request bed directly from hospital row
  async function quickBookBedForHospital(hospital_user_id) {
    setMsg('');
    try {
      // Ensure services loaded and pick a bed-like service, else the first available
      const list = await ensureHospitalServices(Number(hospital_user_id));
      if (!Array.isArray(list) || list.length === 0) {
        // No services configured; post a note to activity as fallback and inform the user
        try {
          await api.incidentAddNote(crisis.incident_id, `[Hospital] Emergency bed requested by user${me?.id?` #${me.id}`:''} for Hospital #${hospital_user_id}.`);
        } catch {}
        setMsg('This hospital has not configured services for booking yet. We posted a note to the crisis asking for an emergency bed.');
        return;
      }
      const bed = list.find(s => /bed|admission|\bER\b|emergency/i.test(String(s.name||''))) || list[0];
      // Try to get location, but don't block if denied
      let lat = null, lng = null;
      try {
        if (navigator.geolocation) {
          await new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition((pos)=>{ lat=pos?.coords?.latitude??null; lng=pos?.coords?.longitude??null; resolve(); }, ()=>resolve(), { enableHighAccuracy: true, timeout: 5000 });
          });
        }
      } catch {}
      const scheduled_at = null; // ASAP
      const notesOut = /bed|admission|\bER\b|emergency/i.test(String(bed.name||'')) ? 'Emergency bed requested' : 'Service requested';
      await api.bookServiceWithDetails(Number(bed.id), Number(hospital_user_id), scheduled_at, notesOut, lat, lng, { crisis_id: (crisis && (crisis.crisis_id || crisis.id)) });
      setShowSuccess(true);
      setMsg('Hospital request submitted. You can track it in My Requests.');
      try { window.dispatchEvent(new CustomEvent('requests-updated', { detail: { type: 'hospital' } })); } catch {}
    } catch (e) {
      setMsg(e.message || 'Failed to submit');
    }
  }

  // Removed legacy hospital booking form; using one-click Request bed per hospital only.

  // Blood requests form state
  const [blood, setBlood] = useState({ bank_user_id: '', blood_type: '', quantity_units: '', target_datetime: '', location_text: '' });
  const [donorReq, setDonorReq] = useState({ donor_user_id: '', blood_type: '', target_datetime: '', location_text: '' });

  // Crisis blood bank inventory summary (for victims to see stocks and request quickly)
  const [bbSummary, setBbSummary] = useState([]);
  const [bbSortType, setBbSortType] = useState('');
  // Per-bank selected blood type for quick requests
  const [bbSelectedType, setBbSelectedType] = useState({}); // { [bank_user_id]: 'A+' }
  // Per-bank quick request is one-click; no per-row type/qty controls anymore
  const BT = ['A+','A-','B+','B-','O+','O-','AB+','AB-'];
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await api.crisisBloodInventorySummary(crisis.crisis_id || crisis.id);
        if (!mounted) return;
        setBbSummary(r.results || []);
      } catch {}
    })();
    return () => { mounted = false; };
  }, [crisis.crisis_id, crisis.id]);

  const bbRows = useMemo(() => {
    const rows = Array.isArray(bbSummary) ? [...bbSummary] : [];
    if (bbSortType && BT.includes(bbSortType)) {
      rows.sort((a, b) => (Number(b?.inventory?.[bbSortType] || 0) - Number(a?.inventory?.[bbSortType] || 0)));
    }
    return rows;
  }, [bbSummary, bbSortType, BT]);

  // Auto-pick defaults for faster zero-input submission
  useEffect(() => {
    // If no bank selected, pick the one with the highest total inventory
    if (!blood.bank_user_id && Array.isArray(bbSummary) && bbSummary.length) {
      const best = [...bbSummary].sort((a,b)=>{
        const sa = Object.values(a.inventory||{}).reduce((s,v)=>s+Number(v||0),0);
        const sb = Object.values(b.inventory||{}).reduce((s,v)=>s+Number(v||0),0);
        return sb-sa;
      })[0];
      if (best && best.bank_user_id) setBlood(b => ({ ...b, bank_user_id: String(best.bank_user_id) }));
    }
    // If no blood type selected, choose the type with the highest stock in selected bank
    if (blood.bank_user_id && !blood.blood_type) {
      const bank = (bbSummary||[]).find(x => String(x.bank_user_id)===String(blood.bank_user_id));
      if (bank) {
        const entries = Object.entries(bank.inventory||{});
        if (entries.length) {
          const [bestType] = entries.sort((a,b)=>Number(b[1]||0)-Number(a[1]||0))[0];
          if (bestType) setBlood(b => ({ ...b, blood_type: bestType }));
        }
      }
    }
    // If quantity empty, default to 1
    if (!blood.quantity_units) {
      setBlood(b => ({ ...b, quantity_units: '1' }));
    }
  }, [bbSummary, blood.bank_user_id, blood.blood_type, blood.quantity_units]);

  async function quickRequestInventory(bank_user_id, blood_type, qty) {
    setMsg('');
    const crisisId = (crisis && (crisis.crisis_id || crisis.id));
    // Auto-fill when missing
    let bank = bank_user_id;
    // Prefer explicitly chosen type from row selector; do not auto-assume
    let chosenFromSelector = (bbSelectedType && bbSelectedType[bank_user_id]) || '';
    let bt = (blood_type || chosenFromSelector || '').toUpperCase();
    let qn = parseInt(qty, 10);
    if (!bank) {
      const best = [...(bbSummary||[])].sort((a,b)=>{
        const sa = Object.values(a.inventory||{}).reduce((s,v)=>s+Number(v||0),0);
        const sb = Object.values(b.inventory||{}).reduce((s,v)=>s+Number(v||0),0);
        return sb-sa;
      })[0];
      bank = best?.bank_user_id;
    }
    // Require user to choose a blood type instead of auto-picking
    if (!bt) { setMsg('Please select a blood type.'); return; }
    if (!qn || qn < 1) qn = 1;
    if (!bank || !BT.includes(bt)) { setMsg('No eligible blood bank/type found.'); return; }
    try {
      await api.createInventoryRequest({ bank_user_id: Number(bank), blood_type: bt, quantity_units: qn, crisis_id: crisisId });
      setMsg('Blood inventory request submitted.');
      setShowSuccess(true);
      try { window.dispatchEvent(new CustomEvent('requests-updated', { detail: { type: 'blood_inventory' } })); } catch {}
    } catch (e) { setMsg(e.message || 'Failed to submit'); }
  }
  // Removed unused donor/inventory submission helpers; quick one-click flows are used instead.

  // Fire request form state
  const [fire, setFire] = useState({ description: '', useMyLocation: true });
  async function submitFireRequest() {
    setMsg('');
    if (!fire.description.trim()) { setMsg('Describe the fire/emergency.'); return; }
    try {
      let lat = null, lng = null;
      if (fire.useMyLocation) {
        if (geo.lat == null || geo.lng == null) {
          const got = await getLocation();
          lat = (got && typeof got.lat === 'number') ? got.lat : geo.lat;
          lng = (got && typeof got.lng === 'number') ? got.lng : geo.lng;
        } else {
          lat = geo.lat; lng = geo.lng;
        }
      }
      await api.createFireRequest(fire.description.trim(), lat, lng);
      setMsg('Fire service request submitted.');
      setShowSuccess(true);
      setFire({ description: '', useMyLocation: true });
      try { window.dispatchEvent(new CustomEvent('requests-updated', { detail: { type: 'fire' } })); } catch {}
    } catch (e) { setMsg(e.message || 'Failed to submit'); }
  }

  // Removed resFor helper (was used only by the deleted manual hospital form)

  if (!hospitals.length && !bloodBanks.length && !fireServices.length) return null;

  return (
    <div className="bg-white p-6 rounded shadow">
      <h3 className="font-semibold mb-2">Request Services</h3>
      <div className="text-xs text-gray-600 mb-3">These organizations have enlisted in this crisis. You can request help below. Your requests are visible to the respective organizations.</div>

      {/* Toggle: Hospital vs Blood Bank vs Fire Service vs My Requests */}
      <div className="flex gap-2 mb-4">
        <button onClick={()=>setSvcTab('hospital')} className={`px-3 py-1 rounded ${svcTab==='hospital'?'bg-indigo-600 text-white':'bg-gray-100'}`}>Hospital</button>
        <button onClick={()=>setSvcTab('blood')} className={`px-3 py-1 rounded ${svcTab==='blood'?'bg-indigo-600 text-white':'bg-gray-100'}`}>Blood Bank</button>
        {fireServices.length > 0 && (
          <button onClick={()=>setSvcTab('fire')} className={`px-3 py-1 rounded ${svcTab==='fire'?'bg-indigo-600 text-white':'bg-gray-100'}`}>Fire Service</button>
        )}
        <button onClick={()=>setSvcTab('my')} className={`px-3 py-1 rounded ${svcTab==='my'?'bg-indigo-600 text-white':'bg-gray-100'}`}>My Requests</button>
      </div>

      {/* My Requests */}
      {svcTab==='my' && (
        <MyRequestsTab crisis={crisis} onRefresh={()=>{ try { window.dispatchEvent(new CustomEvent('requests-updated')); } catch {} }} />
      )}

      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={()=>setShowSuccess(false)} />
          <div className="relative bg-white rounded shadow-lg w-[90%] max-w-md p-5">
            <div className="text-lg font-semibold mb-2">Request submitted</div>
            <div className="text-sm text-gray-700 whitespace-pre-line">{msg || 'Your request was submitted successfully.'}</div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-2 text-gray-700" onClick={()=>setShowSuccess(false)}>Close</button>
              <button className="px-3 py-2 bg-indigo-600 text-white rounded" onClick={()=>setShowSuccess(false)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Hospitals */}
      {svcTab==='hospital' && hospitals.length > 0 && (
        <div className="mb-6">
          <div className="font-medium mb-2">Hospitals</div>
          {/* Quick list of hospitals with available beds */}
          <div className="mb-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2">Hospital</th>
                  <th>Beds Available</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {hospitals.map(h => {
                  const r = (hospitalResources || []).find(r => Number(r.hospital_user_id)===Number(h.user_id));
                  const beds = r && r.available_beds != null ? Number(r.available_beds) : null;
                  const name = h.user_name || h.user_email || `User #${h.user_id}`;
                  return (
                    <tr key={h.id || h.user_id} className="border-t">
                      <td className="py-2">{name}</td>
                      <td>{beds != null ? beds : 'n/a'}</td>
                      <td>
                        <button
                          type="button"
                          className="px-2 py-1 text-xs bg-emerald-600 text-white rounded"
                          onClick={() => quickBookBedForHospital(h.user_id)}
                        >Request bed</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!hospitals.length ? (
              <div className="text-sm text-gray-600 mt-2">No hospitals enlisted yet.</div>
            ) : null}
            {!!hospitals.length && !(hospitalResources||[]).length && (
              <div className="text-xs text-gray-500 mt-2">No hospital has reported beds for this incident yet.</div>
            )}
          {/* Removed manual hospital request form; use one-click buttons in the table above. */}
        </div>
        {/* Close Hospitals section wrapper */}
        </div>
      )}

      {/* Blood banks */}
      {svcTab==='blood' && bloodBanks.length > 0 && (
        <div className="mb-6">
          <div className="font-medium mb-2">Blood Banks</div>
          {/* Inventory summary and quick request */}
          <div className="p-3 border rounded bg-gray-50 mb-3">
            <div className="flex items-center gap-3 mb-2">
              <div className="text-sm font-medium">Inventory Overview</div>
              <div className="ml-auto flex items-center gap-2">
                <label className="text-xs text-gray-600">Sort by blood type</label>
                <select value={bbSortType} onChange={e=>setBbSortType(e.target.value)} className="border rounded px-2 py-1 text-sm">
                  <option value="">—</option>
                  {BT.map(bt => <option key={bt} value={bt}>{bt}</option>)}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2">Bank</th>
                    {BT.map(bt => <th key={bt}>{bt}</th>)}
                    <th>Request</th>
                  </tr>
                </thead>
                <tbody>
                  {(bbRows || []).map(b => {
                    const availableTypes = BT.filter(t => Number(b?.inventory?.[t] || 0) > 0);
                    const sel = bbSelectedType[b.bank_user_id] || '';
                    return (
                      <tr key={b.bank_user_id} className="border-t">
                        <td className="py-2">{b.bank_name || b.bank_email || `User #${b.bank_user_id}`}</td>
                        {BT.map(bt => <td key={bt}>{Number(b?.inventory?.[bt] || 0)}</td>)}
                        <td className="whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <select
                              className="border rounded px-1 py-0.5 text-xs disabled:opacity-50"
                              value={sel}
                              disabled={isClosed}
                              onChange={e=>setBbSelectedType(s=>({ ...s, [b.bank_user_id]: e.target.value }))}
                            >
                              <option value="">Select type</option>
                              {(availableTypes.length ? availableTypes : BT).map(t => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                            <button
                              className="px-2 py-1 text-xs bg-rose-600 text-white rounded disabled:opacity-50"
                              disabled={isClosed}
                              onClick={()=>quickRequestInventory(b.bank_user_id, sel)}
                            >Request</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!(bbRows||[]).length && (
                <div className="text-xs text-gray-500 mt-2">No enlisted blood banks have reported inventory yet.</div>
              )}
            </div>
          </div>
          {/* Removed lower forms; keep only the one-click per-bank Request above */}
        </div>
      )}

      {/* Fire services */}
      {svcTab==='fire' && fireServices.length > 0 && (
        <div className="mb-2">
          <div className="font-medium mb-2">Fire Services</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="block text-sm">Describe the emergency</label>
              <input value={fire.description} onChange={e=>setFire(f=>({ ...f, description: e.target.value }))} className="mt-1 w-full border rounded px-3 py-2" placeholder="e.g., Fire in 3rd floor, people trapped" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm inline-flex items-center gap-2">
                <input type="checkbox" checked={fire.useMyLocation} onChange={e=>setFire(f=>({ ...f, useMyLocation: e.target.checked }))} /> Use my location
              </label>
              {fire.useMyLocation && (
                <button type="button" className="text-xs text-indigo-700" onClick={getLocation} disabled={geo.loading}>{geo.loading ? 'Locating…' : 'Refresh'}</button>
              )}
            </div>
          </div>
          <div className="mt-2">
            <button className="px-3 py-2 bg-orange-600 text-white rounded" onClick={submitFireRequest}>Request Fire Team</button>
          </div>
        </div>
      )}

      {msg && <div className={`mt-3 text-xs ${/failed|error|invalid|forbidden/i.test(msg)?'text-red-600':'text-emerald-700'}`}>{msg}</div>}
    </div>
  );
}

function MyRequestsTab({ crisis, onRefresh }) {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [items, setItems] = useState([]);

  const crisisId = (crisis && (crisis.crisis_id || crisis.id));

  const load = useCallback(async () => {
    setLoading(true); setMsg('');
    try {
      // Gather three sources in parallel
      const [svc, inv, dm, fire] = await Promise.all([
        api.myServiceBookings({ crisis_id: crisisId }),
        api.listInventoryRequests({ requester_user_id: me?.id, crisis_id: crisisId }),
        api.listDonorMeetingRequests({ requester_user_id: me?.id, crisis_id: crisisId }),
        api.myFireRequests().catch(() => ({ results: [] })),
      ]);
      const svcList = (svc?.results || [])
        // Results already scoped by backend when crisisId provided; keep a defensive check.
        .filter(x => !x.hidden_by_user && (crisisId == null || Number(x.crisis_id) === Number(crisisId)))
        .map(x => ({
          type: 'hospital',
          id: x.id,
          created_at: x.created_at || x.scheduled_at,
          status: x.status,
          target_datetime: x.scheduled_at,
          title: x.service_name || 'Service',
          counterparty: x.hospital_name || (x.hospital_user_id ? `Hospital #${x.hospital_user_id}` : 'Hospital'),
        }));
      const invList = (inv?.results || inv || [])
        .map(x => ({
          type: 'inventory',
          id: x.id,
          created_at: x.created_at,
          status: x.status,
          target_datetime: x.target_datetime,
          title: `${x.blood_type || ''} × ${x.quantity_units || ''}`,
          counterparty: x.bank_user_id ? `Bank #${x.bank_user_id}` : 'Blood Bank',
        }));
      const dmList = (dm?.results || dm || [])
        .map(x => ({
          type: 'donor',
          id: x.id,
          created_at: x.created_at,
          status: x.status,
          target_datetime: x.target_datetime,
          title: x.blood_type || 'Donor meeting',
          counterparty: x.donor_user_id ? `Donor #${x.donor_user_id}` : 'Donor',
        }));
      const fireList = (fire?.results || fire || [])
        // scope to this crisis when possible: include if crisis has coords (backend not tagging) or just include all mine for now
        .map(x => ({
          type: 'fire',
          id: x.id,
          created_at: x.created_at,
          status: x.status,
          target_datetime: null,
          title: x.description || 'Fire request',
          counterparty: x.assigned_department_name ? x.assigned_department_name : (x.assigned_department_id ? `Department #${x.assigned_department_id}` : '—'),
        }));
      const merged = [...svcList, ...invList, ...dmList, ...fireList]
        .sort((a,b)=>{
          const at = new Date(a.created_at || a.target_datetime || 0).getTime();
          const bt = new Date(b.created_at || b.target_datetime || 0).getTime();
          return bt - at;
        });
      setItems(merged);
    } catch(e) {
      setMsg(e.message || 'Failed to load');
    } finally { setLoading(false); }
  }, [crisisId, me?.id]);

  useEffect(() => { load(); }, [load]);

  async function cancelItem(it) {
    setMsg('');
    try {
      if (it.type === 'hospital') {
        if (!window.confirm('Cancel this hospital booking? You can cancel up to 2 hours before the scheduled time.')) return;
        await api.cancelServiceBooking(it.id);
      } else if (it.type === 'inventory') {
        if (!window.confirm('Cancel this blood inventory request?')) return;
        await api.updateInventoryRequestStatus(it.id, 'cancelled', {});
      } else if (it.type === 'donor') {
        if (!window.confirm('Cancel this donor meeting request?')) return;
        await api.updateDonorMeetingRequestStatus(it.id, 'cancelled', {});
      } else if (it.type === 'fire') {
        if (!window.confirm('Cancel this fire service request?')) return;
        await api.cancelFireRequest(it.id);
      }
      await load();
      try { window.dispatchEvent(new CustomEvent('requests-updated')); } catch {}
      if (onRefresh) onRefresh();
    } catch (e) {
      setMsg(e.message || 'Failed to cancel');
    }
  }

  async function deleteItem(it) {
    setMsg('');
    try {
      if (it.type === 'hospital') {
        if (!window.confirm('Hide this booking from your view?')) return;
        await api.hideServiceBooking(it.id);
      } else if (it.type === 'fire') {
        if (!window.confirm('Remove this fire request from your list? This won\'t delete responder logs.')) return;
        await api.hideFireRequest(it.id);
      } else {
        // No delete/hide endpoint for blood requests; surface guidance
        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Delete is not available for this request type. You can cancel instead.' } }));
        return;
      }
      await load();
      if (onRefresh) onRefresh();
    } catch (e) {
      setMsg(e.message || 'Failed to delete');
    }
  }

  return (
    <div className="mb-6">
      <div className="font-medium mb-2">My Requests</div>
      {loading ? (
        <div>Loading…</div>
      ) : !items.length ? (
        <div className="text-sm text-gray-600">You don’t have any requests yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2">Type</th>
                <th>Title</th>
                <th>Counterparty</th>
                <th>When</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={`${it.type}-${it.id}`} className="border-t">
                  <td className="py-2">{it.type === 'hospital' ? 'Hospital' : it.type === 'inventory' ? 'Blood Inventory' : it.type === 'donor' ? 'Donor Meeting' : it.type === 'fire' ? 'Fire Service' : it.type}</td>
                  <td>{it.title || '—'}</td>
                  <td>{it.counterparty || '—'}</td>
                  <td>{it.target_datetime ? new Date(it.target_datetime).toLocaleString() : ''}</td>
                  <td>{it.status}</td>
                  <td className="space-x-2">
                    {(it.status === 'pending' || it.status === 'accepted' || (it.type==='hospital' && it.status==='booked')) && (
                      <button className="px-2 py-1 text-xs bg-gray-200 text-gray-900 rounded" onClick={()=>cancelItem(it)}>Cancel</button>
                    )}
                    {(it.type === 'hospital' || it.type === 'fire') && (
                      <button className="px-2 py-1 text-xs bg-gray-700 text-white rounded" onClick={()=>deleteItem(it)}>Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {msg && <div className={`mt-3 text-xs ${/failed|error|invalid|forbidden/i.test(msg)?'text-red-600':'text-emerald-700'}`}>{msg}</div>}
    </div>
  );
}

function BloodBankCrisisPanel({ crisisId }) {
  const [tab, setTab] = useState('alloc'); // 'alloc' | 'donors'
  const [donors, setDonors] = useState([]);
  const [bankDonors, setBankDonors] = useState([]);
  const [donorQuery, setDonorQuery] = useState('');
  const [allocs, setAllocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Add donor form
  const [donorUserId, setDonorUserId] = useState('');
  const [donorBloodType, setDonorBloodType] = useState('');
  const [donorNotes, setDonorNotes] = useState('');
  // Allocate form
  const [allocType, setAllocType] = useState('');
  const [allocQty, setAllocQty] = useState('');
  const [allocPurpose, setAllocPurpose] = useState('');

  const load = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([
        api.crisisBloodDonorsList(crisisId, { with_users: 1 }),
        api.crisisBloodAllocationsList(crisisId),
      ]);
      setDonors(d.results || []);
      setAllocs(a.results || []);
    } catch {}
  }, [crisisId]);

  useEffect(() => { load(); }, [load]);

  // Load my bank's donors once for search/selection
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Request with user enrichment so we can show names/emails/avatars
        const r = await api.request('/blood-bank/donors/list?with_users=1');
        if (mounted) {
          const arr = Array.isArray(r) ? r : (r && Array.isArray(r.results)) ? r.results : [];
          setBankDonors(arr);
        }
      } catch {}
    })();
    return () => { mounted = false; };
  }, []);

  const BT = ['A+','A-','B+','B-','O+','O-','AB+','AB-'];

  async function addDonor() {
    const uid = parseInt(donorUserId, 10);
    const bt = donorBloodType || null;
    if (!uid) { setMsg('Enter donor user id.'); return; }
    if (bt && !BT.includes(bt)) { setMsg('Invalid blood type.'); return; }
    setBusy(true); setMsg('');
    try {
      await api.crisisBloodDonorsAdd(crisisId, uid, bt, donorNotes || null);
      setDonorUserId(''); setDonorBloodType(''); setDonorNotes('');
      await load();
    } catch (e) { setMsg(e.message || 'Failed to add'); } finally { setBusy(false); }
  }

  async function addDonorFromBank(d) {
    const uid = d?.donor_user_id || d?.user_id;
    if (!uid) { setMsg('Missing donor user id on record'); return; }
    setBusy(true); setMsg('');
    try {
      const bt = d?.blood_type || null;
      await api.crisisBloodDonorsAdd(crisisId, uid, bt, null);
      await load();
    } catch (e) { setMsg(e.message || 'Failed to add from bank'); } finally { setBusy(false); }
  }

  async function removeDonor(id) {
    if (!window.confirm('Remove this donor from this crisis?')) return;
    setBusy(true); setMsg('');
    try { await api.crisisBloodDonorsRemove(crisisId, id); await load(); }
    catch (e) { setMsg(e.message || 'Failed'); }
    setBusy(false);
  }

  async function allocate() {
    const qty = parseInt(allocQty, 10);
    if (!BT.includes(allocType) || !qty || qty < 1) { setMsg('Enter blood type and quantity.'); return; }
    setBusy(true); setMsg('');
    try {
      await api.crisisBloodAllocate(crisisId, allocType, qty, allocPurpose || null);
      setAllocType(''); setAllocQty(''); setAllocPurpose('');
      await load();
    } catch (e) { setMsg(e.message || 'Failed to allocate'); } finally { setBusy(false); }
  }

  async function revertAllocation(a) {
    if (String(a.status||'') === 'reverted') return;
    if (!window.confirm('Mark this allocation as reverted and restore stock?')) return;
    setBusy(true); setMsg('');
    try { await api.crisisBloodAllocationUpdate(crisisId, a.id, { status: 'reverted' }); await load(); }
    catch (e) { setMsg(e.message || 'Failed to revert'); }
    setBusy(false);
  }

  async function deleteAllocation(a) {
    if (!window.confirm('Delete this allocation? If still allocated, stock will be restored.')) return;
    setBusy(true); setMsg('');
    try { await api.crisisBloodAllocationDelete(crisisId, a.id); await load(); }
    catch (e) { setMsg(e.message || 'Failed to delete'); }
    setBusy(false);
  }

  return (
    <div className="bg-white p-6 rounded shadow">
      <h3 className="font-semibold mb-2">Blood Bank: Crisis Support</h3>
      <div className="text-xs text-gray-600 mb-3">Link donors to this crisis and allocate units from your bank inventory. Actions appear in the public activity timeline.</div>
      <div className="flex gap-2 mb-4">
        <button onClick={()=>setTab('alloc')} className={`px-3 py-1 rounded ${tab==='alloc'?'bg-indigo-600 text-white':'bg-gray-100'}`}>Allocations</button>
        <button onClick={()=>setTab('donors')} className={`px-3 py-1 rounded ${tab==='donors'?'bg-indigo-600 text-white':'bg-gray-100'}`}>Donors in Crisis</button>
      </div>
      {tab==='donors' ? (
        <div className="space-y-3">
          <div className="p-3 border rounded bg-gray-50">
            <div className="font-medium mb-2">Search my bank donors</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="block text-sm">Search (name, email, blood type)</label>
                <input value={donorQuery} onChange={e=>setDonorQuery(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" placeholder="e.g., O+, Alice" />
              </div>
            </div>
            <div className="mt-3">
              {(()=>{
                const q = donorQuery.trim().toLowerCase();
                let list = Array.isArray(bankDonors) ? bankDonors : [];
                if (q) {
                  list = list.filter(d => {
                    const name = (d.donor_name || d.user_name || d.name || '').toLowerCase();
                    const email = (d.donor_email || d.user_email || d.email || '').toLowerCase();
                    const bt = (d.blood_type || '').toLowerCase();
                    return name.includes(q) || email.includes(q) || bt.includes(q);
                  });
                }
                // Hide donors already linked
                const linkedIds = new Set((Array.isArray(donors) ? donors : []).map(x => x.donor_user_id));
                list = list.filter(d => !linkedIds.has(d.donor_user_id || d.user_id));
                const top = list.slice(0, 10);
                if (!top.length) return <div className="text-xs text-gray-600">{q ? 'No matching donors.' : 'Start typing to search your donor list.'}</div>;
                return (
                  <div className="divide-y">
                    {top.map(d => {
                      const name = d.donor_name || d.user_name || d.name || null;
                      const email = d.donor_email || d.user_email || d.email || null;
                      const blood = d.blood_type || '—';
                      const avatar = d.donor_avatar_url || d.user_avatar_url || d.avatar_url || null;
                      return (
                        <div key={(d.id||'')+':' + (d.donor_user_id||d.user_id)} className="py-2 flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            {avatar ? (<img src={avatar} alt="" className="w-7 h-7 rounded-full object-cover border" />) : (<div className="w-7 h-7 rounded-full bg-gray-200" />)}
                            <div className="truncate">
                              <div className="font-medium truncate">{name || (email ? email.split('@')[0] : 'Unknown donor')}</div>
                              <div className="text-xs text-gray-600 truncate">{email || (name ? '' : 'No email')}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-800 border">{blood}</span>
                            <button disabled={busy} onClick={()=>addDonorFromBank(d)} className="px-3 py-1 text-xs bg-blue-600 text-white rounded disabled:opacity-50">Add</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
          {/* Manual add by user id removed to keep UX friendly and avoid raw IDs */}
          {!donors.length ? (
            <div className="text-sm text-gray-600">No donors linked yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2">Donor</th>
                  <th>Blood</th>
                  <th>Notes</th>
                  <th>When</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {donors.map(d => (
                  <tr key={d.id} className="border-t">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        {d.donor_avatar_url ? (<img src={d.donor_avatar_url} alt="" className="w-6 h-6 rounded-full object-cover border" />) : (<div className="w-6 h-6 rounded-full bg-gray-200" />)}
                        <div>
                          <div className="font-medium">{d.donor_name || (d.donor_email ? d.donor_email.split('@')[0] : 'Unknown donor')}</div>
                          <div className="text-xs text-gray-600">{d.donor_email || ''}</div>
                        </div>
                      </div>
                    </td>
                    <td>{d.blood_type}</td>
                    <td>{d.notes || ''}</td>
                    <td>{d.created_at ? new Date(d.created_at).toLocaleString() : ''}</td>
                    <td>
                      <button disabled={busy} onClick={()=>removeDonor(d.id)} className="px-2 py-1 text-xs bg-gray-700 text-white rounded disabled:opacity-50">Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div>
              <label className="block text-sm">Blood Type</label>
              <select value={allocType} onChange={e=>setAllocType(e.target.value)} className="mt-1 w-full border rounded px-3 py-2">
                <option value="">-- Select --</option>
                {BT.map(bt => <option key={bt} value={bt}>{bt}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm">Quantity (units)</label>
              <input type="number" min="1" value={allocQty} onChange={e=>setAllocQty(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm">Purpose (optional)</label>
              <input value={allocPurpose} onChange={e=>setAllocPurpose(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
            </div>
            <div className="flex items-end">
              <button disabled={busy} onClick={allocate} className="w-full px-3 py-2 bg-emerald-600 text-white rounded disabled:opacity-50">{busy? 'Allocating…':'Allocate'}</button>
            </div>
          </div>
          {!allocs.length ? (
            <div className="text-sm text-gray-600">No allocations yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2">Blood</th>
                  <th>Units</th>
                  <th>Status</th>
                  <th>Purpose</th>
                  <th>When</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {allocs.map(a => (
                  <tr key={a.id} className="border-t">
                    <td className="py-2">{a.blood_type}</td>
                    <td>{a.quantity_units}</td>
                    <td><span className={`inline-block px-1 rounded ${String(a.status||'allocated')==='allocated'?'bg-yellow-100 text-yellow-800':'bg-gray-100 text-gray-700'}`}>{a.status}</span></td>
                    <td>{a.purpose || ''}</td>
                    <td>{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</td>
                    <td className="space-x-2">
                      {String(a.status||'allocated')==='allocated' && (
                        <button disabled={busy} onClick={()=>revertAllocation(a)} className="px-2 py-1 text-xs bg-orange-600 text-white rounded disabled:opacity-50">Revert</button>
                      )}
                      <button disabled={busy} onClick={()=>deleteAllocation(a)} className="px-2 py-1 text-xs bg-gray-700 text-white rounded disabled:opacity-50">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {msg && <div className={`mt-3 text-xs ${/failed|error|invalid|forbidden|insufficient/i.test(msg)?'text-red-600':'text-emerald-700'}`}>{msg}</div>}
    </div>
  );
}

function VictimsPanel({ id, isAdmin, isActiveParticipant }) {
  const [enrolling, setEnrolling] = useState(false);
  const [victims, setVictims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminUserId, setAdminUserId] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [busy, setBusy] = useState(false);
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const meId = me?.id ? Number(me.id) : null;
  const [locBusy, setLocBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.request(`/crises/${id}/victims/list?with_users=1&page=1&page_size=10`);
      const items = r.results || [];
      // Defensive: dedupe by user_id to avoid double rows if backend cache lags
      const uniq = [];
      const seen = new Set();
      for (const it of items) {
        const k = String(it.user_id ?? it.id);
        if (!seen.has(k)) { seen.add(k); uniq.push(it); }
      }
      setVictims(uniq);
      setPage(1);
      const total = r.total || 0; const len = (r.results || []).length;
      setHasMore((r.next_page || 0) > 1 || total > len);
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function shareMyLocation() {
    if (!navigator.geolocation) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Geolocation not available in this browser.' } }));
      return;
    }
    setLocBusy(true);
    try {
      await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(async (pos) => {
          try {
            const { latitude, longitude } = pos.coords || {};
            if (typeof latitude === 'number' && typeof longitude === 'number') {
              try { await api.request('/location/update', 'POST', { lat: latitude, lng: longitude }, { silent: true }); }
              catch (_) { /* noop */ }
              await load();
              window.dispatchEvent(new CustomEvent('api-toast', { detail: { message: 'Location updated.' } }));
            } else {
              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Could not read coordinates.' } }));
            }
          } finally {
            resolve();
          }
        }, (err) => {
          window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err?.message || 'Location permission denied.' } }));
          resolve();
        }, { enableHighAccuracy: true, timeout: 7000 });
      });
    } finally {
      setLocBusy(false);
    }
  }

  return (
    <div className="bg-white p-6 rounded shadow">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Victims</h3>
        <button disabled={enrolling} onClick={async ()=>{
          setEnrolling(true);
          try { await api.crisisVictimsEnroll(id, null); await load(); }
          catch (e) { window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to enroll' } })); }
          setEnrolling(false);
        }} className="px-3 py-2 bg-rose-600 text-white rounded disabled:opacity-50">Enroll as Victim</button>
      </div>
      {isAdmin && (
        <div className="mb-3 p-3 border rounded">
          <div className="text-sm font-medium mb-2">Admin: Create request on behalf</div>
          <div className="flex flex-wrap gap-2 items-center">
            <input value={adminEmail} onChange={e=>setAdminEmail(e.target.value)} placeholder="user email" className="border px-2 py-1 rounded text-sm" />
            <span className="text-xs text-gray-400">or</span>
            <input value={adminUserId} onChange={e=>setAdminUserId(e.target.value)} placeholder="user_id" className="border px-2 py-1 rounded text-sm w-24" />
            <input value={adminNote} onChange={e=>setAdminNote(e.target.value)} placeholder="note (optional)" className="border px-2 py-1 rounded text-sm w-56" />
            <button disabled={busy} onClick={async()=>{
              setBusy(true);
              try {
                const body = {};
                if (adminEmail.trim()) body.email = adminEmail.trim();
                if (adminUserId.trim()) body.user_id = Number(adminUserId.trim());
                if (adminNote.trim()) body.note = adminNote.trim();
                if (!body.email && !body.user_id) { throw new Error('Provide email or user_id'); }
                await api.crisisVictimAdminCreate(id, body);
                setAdminEmail(''); setAdminUserId(''); setAdminNote('');
                await load();
              } catch(e) {
                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to create' } }));
              } finally { setBusy(false); }
            }} className="px-3 py-1 bg-indigo-600 text-white rounded text-sm disabled:opacity-50">Create</button>
          </div>
        </div>
      )}
      {loading ? (
        <div>Loading…</div>
      ) : victims.length === 0 ? (
        <div className="text-sm text-gray-600">No victims listed yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="py-2">User</th>
              <th>Location</th>
              <th>Status</th>
              <th>Note</th>
              <th>When</th>
              {(isAdmin || isActiveParticipant) && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {victims.map(v => (
              <tr key={v.id} className="border-t">
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    {v.avatar_url ? (<img src={v.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover border" />) : (<div className="w-6 h-6 rounded-full bg-gray-200" />)}
                    <span>{v.user_name || v.email || `#${v.user_id}`}</span>
                  </div>
                </td>
                <td>
                  {v?.lat != null && v?.lng != null && !isNaN(Number(v.lat)) && !isNaN(Number(v.lng)) ? (
                    <div>
                      <div className="flex items-center gap-2">
                        <span>{Number(v.lat).toFixed(5)}, {Number(v.lng).toFixed(5)}</span>
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(Number(v.lat))}%2C${encodeURIComponent(Number(v.lng))}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-indigo-700 hover:underline"
                          title="Get directions"
                        >Directions</a>
                      </div>
                      {v.last_loc_time ? (
                        <div className="text-[11px] text-gray-500">last seen {new Date(v.last_loc_time).toLocaleString()}</div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="text-gray-400">
                      <span>n/a</span>
                      {meId && Number(v.user_id) === meId && (
                        <button disabled={locBusy} onClick={shareMyLocation} className="ml-2 text-xs text-indigo-700 disabled:opacity-50">{locBusy ? 'Updating…' : 'Share my location'}</button>
                      )}
                    </div>
                  )}
                </td>
                <td>{v.status}</td>
                <td>{v.note || ''}</td>
                <td>{v.created_at ? new Date(v.created_at).toLocaleString() : ''}</td>
                {(isAdmin || isActiveParticipant) && (
                  <td className="space-x-2">
                    {/* Confirm and Mark Pending allowed for admin and participants */}
                    <button onClick={async ()=>{ try { await api.crisisVictimSetStatus(id, v.id, 'confirmed'); await load(); } catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed' } })); } }} className="px-2 py-1 text-xs bg-emerald-600 text-white rounded">Confirm</button>
                    <button onClick={async ()=>{ try { await api.crisisVictimSetStatus(id, v.id, 'pending'); await load(); } catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed' } })); } }} className="px-2 py-1 text-xs bg-yellow-600 text-white rounded">Mark Pending</button>
                    {/* The following actions are admin-only */}
                    {isAdmin && (
                      <>
                        <button onClick={async ()=>{ try { await api.crisisVictimSetStatus(id, v.id, 'dismissed'); await load(); } catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed' } })); } }} className="px-2 py-1 text-xs bg-gray-600 text-white rounded">Dismiss</button>
                        <button onClick={async ()=>{ const newNote = prompt('Edit note', v.note || ''); if (newNote === null) return; try { await api.crisisVictimUpdate(id, v.id, { note: newNote }); await load(); } catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to update note' } })); } }} className="px-2 py-1 text-xs bg-blue-600 text-white rounded">Edit Note</button>
                        <button onClick={async ()=>{ if (!window.confirm('Delete this request?')) return; try { await api.crisisVictimDelete(id, v.id); await load(); } catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to delete' } })); } }} className="px-2 py-1 text-xs bg-red-600 text-white rounded">Delete</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && (
        <div className="mt-2">
          <button onClick={async ()=>{
            const next = page + 1;
            try {
              const r = await api.request(`/crises/${id}/victims/list?with_users=1&page=${next}&page_size=10`);
              const items = r.results || [];
              setVictims(prev => {
                const merged = prev.concat(items);
                const uniq = [];
                const seen = new Set();
                for (const it of merged) {
                  const k = String(it.user_id ?? it.id);
                  if (!seen.has(k)) { seen.add(k); uniq.push(it); }
                }
                return uniq;
              });
              setPage(next);
              const total = r.total || 0;
              setHasMore((r.next_page || 0) > next || total > (next * 10));
            } catch {}
          }} className="text-xs text-indigo-700">Load more</button>
        </div>
      )}
    </div>
  );
}

function PotentialVictims({ id }) {
  const [items, setItems] = useState([]);
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [selfBannerHidden, setSelfBannerHidden] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [loadingPV, setLoadingPV] = useState(false);
  const [locMsg, setLocMsg] = useState('');
  const [updatingLoc, setUpdatingLoc] = useState(false);
  const [notifHint, setNotifHint] = useState(false);

  const loadPV = useCallback(async () => {
    setLoadingPV(true);
    try {
      const r = await api.request(`/crises/${id}/potential-victims?with_users=1`);
      setItems(r.results || []);
    } catch (e) {
      // swallow, toast handled globally
    } finally {
      setLoadingPV(false);
    }
  }, [id]);
  useEffect(() => {
    loadPV();
  }, [loadPV]);

  const meId = me?.id ? Number(me.id) : null;
  const iAmPotential = meId && (items || []).some(it => Number(it.user_id) === meId);
  const showBanner = iAmPotential && !selfBannerHidden;

  // If there is an unread potential_victim_detected notification for this crisis, nudge user
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.listNotifications({ unread: 1, page_size: 50 });
        const list = res.results || res.items || [];
        const hit = list.find(n => n.type === 'potential_victim_detected' && Number(n?.payload?.crisis_id) === Number(id));
        if (mounted) setNotifHint(!!hit);
      } catch {}
    })();
    return () => { mounted = false; };
  }, [id]);

  async function updateMyLocationAndRefresh() {
    setLocMsg('');
    if (!navigator.geolocation) {
      setLocMsg('Geolocation not available in this browser.');
      return;
    }
    setUpdatingLoc(true);
    try {
      await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(async (pos) => {
          try {
            const { latitude, longitude } = pos.coords || {};
            if (typeof latitude === 'number' && typeof longitude === 'number') {
              try { await api.request('/location/update', 'POST', { lat: latitude, lng: longitude }, { silent: true }); }
              catch (_) { /* noop */ }
              await loadPV();
              setLocMsg('Location updated.');
            } else {
              setLocMsg('Could not read coordinates.');
            }
          } catch (err) {
            setLocMsg(err.message || 'Failed to update location.');
          } finally {
            resolve();
          }
        }, (err) => {
          setLocMsg(err?.message || 'Location permission denied.');
          resolve();
        }, { enableHighAccuracy: true, timeout: 7000 });
      });
    } finally {
      setUpdatingLoc(false);
    }
  }

  return (
    <div className="bg-white p-6 rounded shadow">
      <h3 className="font-semibold mb-2">Potential Victims (by radius)</h3>
      {notifHint && !showBanner && (
        <div className="mb-3 p-3 border rounded bg-amber-50 text-sm text-amber-900">
          You're in the affected area for this crisis. If you need help, click "I need assistance" below.
        </div>
      )}
      {showBanner && (
        <div className="mb-3 p-3 border rounded bg-amber-50">
          <div className="text-sm text-amber-900">We detected your last known location is within this crisis radius. Do you need assistance?</div>
          <div className="mt-2 flex items-center gap-2">
            <button
              className="px-3 py-1 text-sm rounded bg-rose-600 text-white disabled:opacity-50"
              disabled={enrolling}
              onClick={async ()=>{
                setEnrolling(true); setStatusMsg('');
                try { await api.crisisVictimsEnroll(id, null); setStatusMsg('Request submitted. An admin will review and confirm.'); }
                catch(e){ setStatusMsg(e.message || 'Failed to submit'); }
                finally { setEnrolling(false); }
              }}
            >{enrolling ? 'Submitting…' : 'I need assistance'}</button>
            <button className="px-3 py-1 text-sm rounded bg-gray-200" onClick={()=>setSelfBannerHidden(true)}>I’m safe (dismiss)</button>
            {statusMsg && <div className={`text-xs ${statusMsg.startsWith('Request')?'text-emerald-700':'text-red-600'}`}>{statusMsg}</div>}
          </div>
        </div>
      )}
      {!showBanner && meId && (
        <div className="mb-3 p-3 border rounded bg-gray-50">
          <div className="text-xs text-gray-700">Not seeing a confirmation prompt? We use your last known location to detect if you're in the affected area.</div>
          <div className="mt-2 flex items-center gap-2">
            <button
              className="px-3 py-1 text-sm rounded bg-indigo-600 text-white disabled:opacity-50"
              onClick={updateMyLocationAndRefresh}
              disabled={updatingLoc}
            >{updatingLoc ? 'Updating location…' : 'Use my current location'}</button>
            {locMsg && <div className="text-xs text-gray-700">{locMsg}</div>}
          </div>
        </div>
      )}
      {!items.length ? (
        <div className="text-sm text-gray-600">{loadingPV ? 'Loading…' : 'None found in radius.'}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600">
              <th className="py-2">User</th>
              <th>Distance (km)</th>
              <th>Last Known Location</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.user_id} className="border-t">
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    {it.avatar_url ? (<img src={it.avatar_url} alt="" className="w-6 h-6 rounded-full object-cover border" />) : (<div className="w-6 h-6 rounded-full bg-gray-200" />)}
                    <span>{(it.user_name || it.email || `#${it.user_id}`)}{meId && Number(it.user_id)===meId ? ' (you)' : ''}</span>
                  </div>
                </td>
                <td>{it.distance_km}</td>
                <td>{it.lat.toFixed(5)}, {it.lng.toFixed(5)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OrgActionPanel({ crisis, isHospital, isBloodBank, isFireService, isSocialOrg, isAdmin, isActiveParticipant, onAfterSubmit }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Show panel only to org roles; require active participation unless admin
  const isOrgRole = isHospital || isBloodBank || isFireService || isSocialOrg;
  if (!isOrgRole) return null;
  const canPost = isAdmin || isActiveParticipant;
  let title = 'Organization Update';
  if (isHospital) title = 'Hospital: Crisis Capacity & Services';
  else if (isBloodBank) title = 'Blood Bank: Inventory & Staffing';
  else if (isFireService) title = 'Fire Service: Team Deployment';
  else if (isSocialOrg) title = 'Social Organization: Volunteers & Aid';

  const placeholder = (
    isHospital ? 'Example: 12 emergency beds available; On-call doctors: Dr. A, Dr. B; Open services: ER, Ambulance.' :
    isBloodBank ? 'Example: 25 units O+, 15 units A+; 3 staff ready for donation camp.' :
    isFireService ? 'Example: Deployed Team Bravo (6 members) to Sector 4; ETA 20 mins.' :
    'Example: 30 volunteers mobilized; distributing water and blankets near main road.'
  );

  async function submit() {
    if (!text.trim()) { setMsg('Please add some details.'); return; }
    setBusy(true); setMsg('');
    try {
      // Prefix note with a category tag so timeline is readable
      const tag = isHospital ? '[Hospital] ' : isBloodBank ? '[BloodBank] ' : isFireService ? '[Fire] ' : '[Social] ';
      await api.incidentAddNote(crisis.incident_id, `${tag}${text.trim()}`);
      setText('');
      setMsg('Posted.');
      if (onAfterSubmit) onAfterSubmit();
    } catch (e) {
      setMsg(e.message || 'Failed to post');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white p-6 rounded shadow">
      <h3 className="font-semibold mb-2">{title}</h3>
      {!canPost ? (
        <div className="text-sm text-gray-700">You must be an approved participant in this crisis to post organization updates. Please request participation and wait for admin approval.</div>
      ) : (
        <>
          <div className="text-xs text-gray-600 mb-2">Share current availability or actions for this crisis. These updates are public in the activity timeline.</div>
          <textarea value={text} onChange={(e)=>setText(e.target.value)} className="w-full border rounded px-3 py-2" rows={3} placeholder={placeholder} />
          <div className="mt-2 flex items-center gap-2">
            <button disabled={busy} onClick={submit} className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50">Post Update</button>
            {msg && <div className={`text-xs ${msg==='Posted.'?'text-emerald-700':'text-red-600'}`}>{msg}</div>}
          </div>
        </>
      )}
    </div>
  );
}

function CrisisActivity({ incidentId }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const pageSize = 10;
  const [filter, setFilter] = useState('all'); // all|fire|hospital|social|finance|victim|other

  const load = useCallback(async (p=1) => {
    try {
      const r = await api.listIncidentEvents(incidentId, { page: p, page_size: pageSize, with_users: 1 });
      const parseTs = (s) => {
        if (!s) return null;
        if (typeof s === 'string' && s.includes(' ') && !s.includes('T')) {
          const iso = s.replace(' ', 'T');
          const d = new Date(iso + 'Z');
          if (!isNaN(d)) return d;
        }
        const d = new Date(s);
        return isNaN(d) ? null : d;
      };
      const incoming = (r.results || []).map(ev => ({ ...ev, _ts: parseTs(ev.created_at) }));
      if (p === 1) setItems(incoming);
      else setItems(prev => prev.concat(incoming));
      const total = r.total || 0;
      setHasMore((r.next_page || 0) > p || total > (p * pageSize));
      setPage(p);
    } catch {}
  }, [incidentId, pageSize]);

  useEffect(() => { if (incidentId) load(1); }, [incidentId, load]);

  // Global nudge: if there's an unread potential_victim_detected, show a toast linking to the crisis page
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.listNotifications({ unread: 1, page_size: 50 });
        const hits = (res.results || []).filter(n => n.type === 'potential_victim_detected');
        if (!hits.length) return;
        const n = hits[0];
        const crisisId = n.payload?.crisis_id;
        const key = `pv_toast:${crisisId || 'any'}`;
        // Avoid spamming: only once per crisis/session
        if (localStorage.getItem(key) === '1') return;
        const distStr = n.payload?.distance_km != null ? ` (${n.payload.distance_km} km)` : '';
        if (!cancelled) {
          window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'info', message: `You are inside a crisis radius${distStr}. Tap to view.` } }));
          try { if (crisisId) localStorage.setItem(key, '1'); } catch {}
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [incidentId]);

  function extractTagAndBody(note) {
    if (typeof note !== 'string') return { tag: null, body: '' };
    const m = note.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
    if (!m) return { tag: null, body: note };
    return { tag: m[1], body: m[2] };
  }

  function categoryOf(note, eventType) {
    const base = String(eventType || '').toLowerCase();
    const { tag } = extractTagAndBody(note || '');
    const t = String(tag || '').toLowerCase();
    if (t.includes('fire')) return 'fire';
    if (t.includes('hospital')) return 'hospital';
    if (t.includes('social') || t.includes('ngo')) return 'social';
    if (t.includes('donation') || t.includes('expense') || t.includes('finance')) return 'finance';
    if (t.includes('victim')) return 'victim';
    if (base && base !== 'note') return base;
    return 'other';
  }

  function CategoryIcon({ cat }) {
    const cls = 'w-5 h-5';
    switch (cat) {
      case 'fire':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor" className={cls}><path d="M12 2c1.5 2.5 3 4 3 6.5 0 1.657-1.343 3-3 3-2 0-3.5-2-3.5-4.5C8.5 5 10 4 12 2zm-5 13c0 3.314 2.686 6 6 6s6-2.686 6-6c0-2.2-1.088-3.69-2.23-4.86-.38-.39-1.01-.09-1 .42.04 1.84-.76 3.44-2.77 3.44-1.98 0-3.06-1.4-3-3.18.02-.53-.62-.83-1-.43C6.79 11.21 7 12.77 7 15z"/></svg>
        );
      case 'hospital':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor" className={cls}><path d="M10 2h4v6h6v4h-6v6h-4v-6H4V8h6z"/></svg>
        );
      case 'social':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor" className={cls}><path d="M16 11c1.657 0 3-1.79 3-4s-1.343-4-3-4-3 1.79-3 4 1.343 4 3 4zM8 11c1.657 0 3-1.79 3-4S9.657 3 8 3 5 4.79 5 7s1.343 4 3 4zm0 2c-2.33 0-7 1.17-7 3.5V20h10v-3.5C11 14.17 6.33 13 4 13zm8 0c-.29 0-.61.02-.96.06 1.16.84 1.96 1.96 1.96 3.44V20h8v-3.5C25 14.17 20.33 13 18 13z"/></svg>
        );
      case 'finance':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor" className={cls}><path d="M11 2h2v3h3v2h-3v6h3v2h-3v3h-2v-3H8v-2h3V7H8V5h3z"/></svg>
        );
      case 'victim':
        return (
          <svg viewBox="0 0 24 24" fill="currentColor" className={cls}><path d="M12 2l10 18H2L12 2zm0 5a1 1 0 00-1 1v4a1 1 0 002 0V8a1 1 0 00-1-1zm0 9a1.25 1.25 0 100 2.5A1.25 1.25 0 0012 16z"/></svg>
        );
      default:
        return (
          <svg viewBox="0 0 24 24" fill="currentColor" className={cls}><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        );
    }
  }

  const catStyles = {
    fire: 'bg-orange-100 text-orange-800',
    hospital: 'bg-red-100 text-red-800',
    social: 'bg-blue-100 text-blue-800',
    finance: 'bg-emerald-100 text-emerald-800',
    victim: 'bg-rose-100 text-rose-800',
    other: 'bg-gray-100 text-gray-800',
  };

  // Sort latest-first (desc by created_at) before filtering/map render
  const sorted = [...items].sort((a,b) => {
    const ta = a._ts ? a._ts.getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
    const tb = b._ts ? b._ts.getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
    return tb - ta;
  });

  const filtered = sorted.filter(ev => {
    if (filter === 'all') return true;
    const cat = categoryOf(ev.note, ev.event_type);
    return cat === filter;
  });

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'fire', label: 'Fire' },
    { key: 'hospital', label: 'Hospital' },
    { key: 'social', label: 'Social' },
    { key: 'finance', label: 'Finance' },
    { key: 'victim', label: 'Victims' },
    { key: 'other', label: 'Other' },
  ];

  return (
    <div className="bg-white p-6 rounded shadow">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Crisis Activity</h3>
        <div className="flex items-center gap-2 text-xs">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2 py-1 rounded border ${filter===f.key ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-700 border-gray-300'}`}
            >{f.label}</button>
          ))}
        </div>
      </div>
      {!items.length ? (
        <div className="text-sm text-gray-600">No activity yet.</div>
      ) : (
        <ul className="space-y-2 text-sm">
          {filtered.map(ev => {
            const cat = categoryOf(ev.note, ev.event_type);
            const { tag, body } = extractTagAndBody(ev.note || '');
            const userName = ev.user_name || ev.user_email || (ev.user_id ? `User #${ev.user_id}` : 'Unknown');
            return (
              <li key={ev.id} className="border rounded p-3">
                <div className="flex items-start gap-3">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${catStyles[cat]}`} title={cat}>
                    <CategoryIcon cat={cat} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-600 capitalize">{ev.event_type || 'event'}</span>
                      {tag && (<span className={`text-xs px-1.5 py-0.5 rounded ${catStyles[cat]}`}>{tag}</span>)}
                    </div>
                    {body && <div className="mt-1 whitespace-pre-wrap">{body}</div>}
                    {!body && ev.note && <div className="mt-1 whitespace-pre-wrap">{ev.note}</div>}
                    <div className="text-xs text-gray-500 mt-2 flex items-center gap-2">
                      {ev.avatar_url ? (
                        <img src={ev.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover border" />
                      ) : (
                        <span className="w-4 h-4 rounded-full bg-gray-200 inline-block" />
                      )}
                      <span>by {userName}</span>
                      <span>• {ev.created_at ? new Date(ev.created_at).toLocaleString() : ''}</span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {hasMore && (
        <button className="mt-3 text-xs text-indigo-700" onClick={()=>load(page+1)}>Load more</button>
      )}
    </div>
  );
}

function HospitalCrisisResourcesPanel({ incidentId }) {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const hospitalId = me?.id; // hospital user id acts as hospital id

  const [form, setForm] = useState({ available_beds: '' });
  const [selectedDoctors, setSelectedDoctors] = useState([]);
  const [selectedServices, setSelectedServices] = useState([]);
  const [doctorOptions, setDoctorOptions] = useState([]); // strings
  const [serviceOptions, setServiceOptions] = useState([]); // strings
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMsg('');
    try {
      // Load existing incident resources (selected values)
      const r = await api.hospitalGetIncidentResources(incidentId);
      if (r && Object.keys(r).length) {
        setForm({ available_beds: r.available_beds ?? '' });
        const docArr = typeof r.doctors === 'string' ? r.doctors.split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean) : [];
        const svcArr = typeof r.services === 'string' ? r.services.split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean) : [];
        setSelectedDoctors(docArr);
        setSelectedServices(svcArr);
      } else {
        setForm({ available_beds: '' });
        setSelectedDoctors([]); setSelectedServices([]);
      }
    } catch (e) {}
    setLoading(false);
  }, [incidentId]);

  // Load hospital-owned options for doctors and services
  const loadOptions = useCallback(async () => {
    try {
      if (!hospitalId) return;
      const [docs, svcs] = await Promise.all([
        api.listHospitalDoctors(hospitalId),
        api.listHospitalServices(hospitalId)
      ]);
      const dOpts = (docs?.results || docs || []).map(d => (d.name || d.full_name || d.doctor_name || d.email || `User #${d.user_id}`)).filter(Boolean);
      const sOpts = (svcs?.results || svcs || []).map(s => (s.name || s.service_name || s.title)).filter(Boolean);
      setDoctorOptions(Array.from(new Set(dOpts)).sort());
      setServiceOptions(Array.from(new Set(sOpts)).sort());
      // Ensure currently selected values are intersected with options (restrict to hospital only)
      setSelectedDoctors(prev => prev.filter(v => dOpts.includes(v)));
      setSelectedServices(prev => prev.filter(v => sOpts.includes(v)));
    } catch (e) { /* ignore */ }
  }, [hospitalId]);

  useEffect(() => { if (incidentId) { load(); loadOptions(); } }, [incidentId, load, loadOptions]);

  async function save() {
    setBusy(true); setMsg('');
    try {
      const body = {};
      if (form.available_beds !== '') body.available_beds = Number(form.available_beds);
      if (selectedDoctors.length) body.doctors = selectedDoctors.join(', ');
      if (selectedServices.length) body.services = selectedServices.join(', ');
      await api.hospitalSetIncidentResources(incidentId, body);
      setMsg('Saved.');
    } catch (e) {
      setMsg(e.message || 'Failed to save');
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm('Delete your hospital resources for this crisis?')) return;
    setBusy(true); setMsg('');
    try {
      await api.hospitalDeleteIncidentResources(incidentId);
      setForm({ available_beds: '' });
      setSelectedDoctors([]); setSelectedServices([]);
      setMsg('Deleted.');
    } catch (e) { setMsg(e.message || 'Failed to delete'); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-white p-6 rounded shadow">
      <h3 className="font-semibold mb-2">Hospital: Crisis Resources</h3>
      <div className="text-xs text-gray-600 mb-2">Share capacity and services dedicated to this crisis. This is your hospital’s view; admins can list all hospitals’ resources.</div>
      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-sm">Available Emergency Beds</label>
              <input type="number" min="0" value={form.available_beds}
                     onChange={e=>setForm(f=>({...f, available_beds: e.target.value}))}
                     className="mt-1 w-full border rounded px-3 py-2" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm">Doctors Assigned</label>
              <SearchableMultiSelect
                options={doctorOptions}
                value={selectedDoctors}
                placeholder="Search doctors in your hospital"
                onChange={setSelectedDoctors}
              />
              <div className="text-xs text-gray-500 mt-1">Only doctors associated with your hospital are shown.</div>
            </div>
          </div>
          <div>
            <label className="block text-sm">Open Services for Victims</label>
            <SearchableMultiSelect
              options={serviceOptions}
              value={selectedServices}
              placeholder="Search services offered by your hospital"
              onChange={setSelectedServices}
            />
            <div className="text-xs text-gray-500 mt-1">Only services configured for your hospital are shown.</div>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={busy} onClick={save} className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
            <button disabled={busy} onClick={remove} className="px-3 py-2 bg-gray-700 text-white rounded disabled:opacity-50">Delete</button>
            {msg && <div className={`text-xs ${msg==='Saved.'||msg==='Deleted.'?'text-emerald-700':'text-red-600'}`}>{msg}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function FireServiceDeploymentPanel({ incidentId }) {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const roleStr = String(me?.role || '').toLowerCase();
  const rolesList = Array.isArray(me?.roles) ? me.roles.map(r => String(r).toLowerCase()) : [];
  const isFireService = roleStr.includes('fire') || rolesList.some(r => r.includes('fire'));
  const isAdmin = roleStr.includes('admin') || rolesList.some(r => r.includes('admin')) || me?.is_admin === true || me?.isAdmin === true;
  const [teams, setTeams] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [deployments, setDeployments] = useState([]);
  const [actionId, setActionId] = useState(null); // deployment id while updating status

  const load = useCallback(async () => {
    try {
      const t = await api.myFireTeams();
      setTeams(t.items || []);
    } catch {}
    try {
      const d = await api.listIncidentFireDeployments(incidentId, { page: 1, page_size: 20 });
      setDeployments(d.results || []);
    } catch {}
  }, [incidentId]);

  useEffect(() => { if (incidentId && isFireService) load(); }, [incidentId, isFireService, load]);

  if (!isFireService) return null;

  async function deploy() {
    if (!selectedTeam) { setMsg('Please select a team.'); return; }
    setBusy(true); setMsg('');
    try {
      await api.incidentDeployFireTeam(incidentId, Number(selectedTeam), note || null);
      setMsg('Deployed.'); setNote('');
      setSelectedTeam('');
      await load();
    } catch (e) {
      setMsg(e.message || 'Failed to deploy');
    } finally { setBusy(false); }
  }

  async function updateStatus(deploymentId, status) {
    if (!deploymentId || !status) return;
    setActionId(deploymentId);
    setMsg('');
    try {
      await api.updateIncidentFireDeploymentStatus(incidentId, deploymentId, status);
      await load();
    } catch (e) {
      setMsg(e.message || 'Failed to update');
    } finally {
      setActionId(null);
    }
  }

  const isAvailable = (t) => String(t.status || '').toLowerCase() === 'available';

  return (
    <div className="bg-white p-6 rounded shadow">
      <h3 className="font-semibold mb-2">Fire Service: Team Deployment</h3>
      <div className="text-xs text-gray-600 mb-2">Deploy one of your teams to this incident. A public activity note will be posted. Only teams marked as available can be deployed.</div>
      <div className="text-xs mb-3">
        <Link to="/fire-teams" className="text-indigo-700 hover:underline">Manage your Fire Teams</Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm">Select Team</label>
          <select value={selectedTeam} onChange={e=>setSelectedTeam(e.target.value)} className="mt-1 w-full border rounded px-3 py-2">
            <option value="">-- Choose team --</option>
            {(teams||[]).map(t => {
              const disabled = !isAvailable(t);
              const label = `${t.name} (${t.status || 'unknown'})${disabled ? ' — unavailable' : ''}`;
              return (
                <option key={t.id} value={t.id} disabled={disabled}>{label}</option>
              );
            })}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm">Note (optional)</label>
          <input value={note} onChange={e=>setNote(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" placeholder="e.g., Sector 4, with foam unit" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button disabled={busy} onClick={deploy} className="px-3 py-2 bg-orange-600 text-white rounded disabled:opacity-50">{busy ? 'Deploying…' : 'Deploy Team'}</button>
        {msg && <div className={`text-xs ${msg==='Deployed.'?'text-emerald-700':'text-red-600'}`}>{msg}</div>}
      </div>
      <div className="mt-4">
        <div className="font-medium mb-2">Recent Deployments</div>
        {!deployments.length ? (
          <div className="text-sm text-gray-600">No deployments yet.</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {deployments.map(d => {
              const status = String(d.status || 'active').toLowerCase();
              const mine = me && Number(d.deployed_by_user_id) === Number(me.id);
              const canAct = status === 'active' && (mine || isAdmin); // backend enforces broader perms (owner/team owner/admin)
              const by = d.deployed_by_user_name || d.deployed_by_user_email || (d.deployed_by_user_id ? `User #${d.deployed_by_user_id}` : null);
              return (
                <li key={d.id} className="border rounded p-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-gray-700">{d.team_name || `Team #${d.team_id}`}</div>
                      {d.note && <div className="text-gray-600">{d.note}</div>}
                      <div className="text-xs text-gray-500">
                        {new Date(d.created_at).toLocaleString()} • <span className={`inline-block px-1 rounded ${status==='active'?'bg-yellow-100 text-yellow-800':status==='completed'?'bg-emerald-100 text-emerald-800':'bg-gray-100 text-gray-700'}`}>{status}</span>
                        {by ? ` • by ${by}` : ''}
                      </div>
                    </div>
                    {canAct && (
                      <div className="flex items-center gap-2">
                        <button
                          disabled={actionId===d.id}
                          onClick={()=>updateStatus(d.id, 'completed')}
                          className="px-2 py-1 text-xs bg-emerald-600 text-white rounded disabled:opacity-50"
                        >{actionId===d.id ? 'Updating…' : 'Complete'}</button>
                        <button
                          disabled={actionId===d.id}
                          onClick={()=>updateStatus(d.id, 'withdrawn')}
                          className="px-2 py-1 text-xs bg-gray-700 text-white rounded disabled:opacity-50"
                        >{actionId===d.id ? 'Updating…' : 'Withdraw'}</button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SocialVolunteerDeploymentPanel({ incidentId }) {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const roleStr = String(me?.role || '').toLowerCase();
  const rolesList = Array.isArray(me?.roles) ? me.roles.map(r => String(r).toLowerCase()) : [];
  const isSocialOrg = roleStr.includes('social') || roleStr.includes('ngo') || rolesList.some(r => r.includes('social') || r.includes('ngo'));
  const isAdmin = roleStr.includes('admin') || rolesList.some(r => r.includes('admin')) || me?.is_admin === true || me?.isAdmin === true;
  const [headcount, setHeadcount] = useState('');
  const [capabilities, setCapabilities] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [deployments, setDeployments] = useState([]);
  const [actionId, setActionId] = useState(null);
  // Remove unused org state to satisfy linter
  const [volunteers, setVolunteers] = useState([]);
  const [selectedVolunteerIds, setSelectedVolunteerIds] = useState([]);
  const [volSearch, setVolSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const filteredVolunteers = useMemo(() => {
    const q = volSearch.trim().toLowerCase();
    const list = Array.isArray(volunteers) ? volunteers : [];
    if (!q) return list;
    return list.filter(v => {
      const name = String(v.user_name || v.full_name || v.display_name || '').toLowerCase();
      const email = String(v.email || '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [volunteers, volSearch]);
  const totalPages = Math.max(1, Math.ceil((filteredVolunteers.length || 0) / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageVolunteers = filteredVolunteers.slice(pageStart, pageStart + PAGE_SIZE);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [totalPages, page]);
  useEffect(() => { setPage(1); }, [volSearch]);
  // When specific volunteers are selected, auto-derive headcount and lock the field
  useEffect(() => {
    const c = Array.isArray(selectedVolunteerIds) ? selectedVolunteerIds.length : 0;
    if (c > 0) setHeadcount(String(c));
  }, [selectedVolunteerIds]);

  const load = useCallback(async () => {
    try {
      const d = await api.listIncidentSocialDeployments(incidentId, { page: 1, page_size: 20, with_users: 1, with_members: 1 });
      setDeployments(d.results || []);
    } catch {}
  }, [incidentId]);

  useEffect(() => { if (incidentId) load(); }, [incidentId, load]);
  // Load my social org and volunteers list for selection
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!isSocialOrg && !isAdmin) return;
      try {
        const o = await api.socialOrgMine();
        if (!mounted) return;
        if (o && o.id) {
          const v = await api.socialOrgListVolunteers(o.id);
          const items = (v && (v.items || v.results)) || [];
          // Only accepted/active volunteers can be selected
          const filtered = items.filter(x => ['accepted','active'].includes(String(x.status||'').toLowerCase()));
          setVolunteers(filtered);
        }
      } catch (e) {
        // silent
      }
    })();
    return () => { mounted = false; };
  }, [isSocialOrg, isAdmin]);

  if (!isSocialOrg && !isAdmin) return null;

  async function deploy() {
    let hc = parseInt(headcount, 10) || 0;
    // If selecting specific volunteers, headcount is derived from selection
    const ids = Array.isArray(selectedVolunteerIds) ? selectedVolunteerIds.filter(Boolean) : [];
    if (ids.length) hc = ids.length;
    if (!hc || hc <= 0) { setMsg('Select volunteers or enter a valid headcount.'); return; }
    setBusy(true); setMsg('');
    try {
      const extra = { capabilities: capabilities || null, note: note || null };
      if (ids.length) extra.volunteer_user_ids = ids.map(Number);
      await api.incidentSocialDeploy(incidentId, hc, extra);
      setMsg('Deployed.'); setHeadcount(''); setCapabilities(''); setNote(''); setSelectedVolunteerIds([]);
      await load();
    } catch (e) { setMsg(e.message || 'Failed to deploy'); }
    finally { setBusy(false); }
  }

  async function updateStatus(deploymentId, status) {
    if (!deploymentId || !status) return;
    setActionId(deploymentId);
    setMsg('');
    try {
      await api.updateIncidentSocialDeploymentStatus(incidentId, deploymentId, status);
      await load();
    } catch (e) { setMsg(e.message || 'Failed to update'); }
    finally { setActionId(null); }
  }

  return (
    <div className="bg-white p-6 rounded shadow">
      <h3 className="font-semibold mb-2">Social Organization: Volunteer Deployment</h3>
      <div className="text-xs text-gray-600 mb-2">Deploy volunteers from your organization to this incident. This posts an activity note visible to all.</div>
      {isSocialOrg && (
        <div className="mb-3 p-2 bg-gray-50 border rounded">
          <div className="text-xs text-gray-700">Select specific volunteers (optional)</div>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
            <div className="max-h-40 overflow-auto border rounded p-2">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-xs text-gray-500">Available volunteers ({filteredVolunteers.length})</div>
                <div className="flex items-center gap-2">
                  <button type="button" className="text-xs px-2 py-1 rounded bg-blue-50 hover:bg-blue-100" onClick={()=>{
                    const ids = pageVolunteers.map(v => Number(v.user_id || v.id)).filter(Boolean);
                    setSelectedVolunteerIds(prev => Array.from(new Set([...(prev||[]), ...ids])));
                  }}>Select all (page)</button>
                  <button type="button" className="text-xs px-2 py-1 rounded bg-gray-50 hover:bg-gray-100" onClick={()=>{ setSelectedVolunteerIds([]); setHeadcount(''); }}>Clear</button>
                </div>
              </div>
              <input
                value={volSearch}
                onChange={e=>setVolSearch(e.target.value)}
                placeholder="Search by name or email"
                className="w-full border rounded px-2 py-1 text-sm mb-2"
              />
              {pageVolunteers.map(v => {
                const id = Number(v.user_id || v.id);
                const name = (
                  v.user_full_name || v.user_name || v.full_name || v.display_name || v.name || v.username || v.user_email || v.email || `User ${id}`
                );
                const selected = selectedVolunteerIds.includes(id);
                const avatar = v.avatar_url;
                return (
                  <label key={id} className="flex items-center gap-2 text-sm py-1">
                    <input type="checkbox" checked={selected} onChange={e=>{
                      const checked = e.target.checked;
                      setSelectedVolunteerIds(prev => checked ? Array.from(new Set([...(prev||[]), id])) : (prev||[]).filter(x => x!==id));
                    }} />
                    {avatar ? (
                      <img src={avatar} alt={name} className="w-6 h-6 rounded-full object-cover" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-gray-200" />
                    )}
                    <span>{name}</span>
                  </label>
                );
              })}
              {(!filteredVolunteers || !filteredVolunteers.length) && (<div className="text-xs text-gray-500">No volunteers found.</div>)}
              {filteredVolunteers.length > PAGE_SIZE && (
                <div className="mt-2 flex items-center justify-between text-xs">
                  <button type="button" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="px-2 py-1 bg-gray-100 rounded disabled:opacity-50">Prev</button>
                  <div>Page {page} of {totalPages}</div>
                  <button type="button" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} className="px-2 py-1 bg-gray-100 rounded disabled:opacity-50">Next</button>
                </div>
              )}
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Selected</div>
              <div className="flex flex-wrap gap-1">
                {(selectedVolunteerIds||[]).map(id => {
                  const v = (volunteers||[]).find(x => Number(x.user_id||x.id)===Number(id));
                  const name = (
                    v?.user_full_name || v?.user_name || v?.full_name || v?.display_name || v?.name || v?.username || v?.user_email || v?.email || `User ${id}`
                  );
                  return (
                    <span key={id} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 rounded text-xs">
                      {name}
                      <button type="button" className="text-blue-700" onClick={()=>setSelectedVolunteerIds(prev => (prev||[]).filter(x => x!==id))}>×</button>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="text-xs text-gray-500 mt-1">When volunteers are selected, headcount is derived automatically.</div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm">Headcount</label>
          <input
            type="number"
            min="1"
            value={headcount}
            onChange={e=>setHeadcount(e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2 disabled:bg-gray-50 disabled:text-gray-600"
            placeholder="e.g., 10"
            disabled={(selectedVolunteerIds||[]).length > 0}
          />
          {(selectedVolunteerIds||[]).length > 0 && (
            <div className="text-xs text-gray-500 mt-1">Headcount is set to the number of selected volunteers ({selectedVolunteerIds.length}).</div>
          )}
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm">Capabilities (optional)</label>
          <input value={capabilities} onChange={e=>setCapabilities(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" placeholder="e.g., food distribution, shelter mgmt" />
        </div>
      </div>
      <div className="mt-3">
        <label className="block text-sm">Note (optional)</label>
        <input value={note} onChange={e=>setNote(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" placeholder="e.g., Focusing on Ward 12" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button disabled={busy} onClick={deploy} className="px-3 py-2 bg-emerald-600 text-white rounded disabled:opacity-50">{busy ? 'Deploying…' : 'Deploy Volunteers'}</button>
        {msg && <div className={`text-xs ${msg==='Deployed.'?'text-emerald-700':'text-red-600'}`}>{msg}</div>}
      </div>
      <div className="mt-4">
        <div className="font-medium mb-2">Recent Social Deployments</div>
        {!deployments.length ? (
          <div className="text-sm text-gray-600">No deployments yet.</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {deployments.map(d => {
              const status = String(d.status || 'active').toLowerCase();
              const mine = me && Number(d.deployed_by_user_id) === Number(me.id);
              const canAct = status === 'active' && (mine || isAdmin);
              const by = d.deployed_by_name || d.deployed_by_email || (d.deployed_by_user_id ? `User #${d.deployed_by_user_id}` : null);
              const label = d.org_name ? d.org_name : `Org #${d.org_id}`;
              return (
                <li key={d.id} className="border rounded p-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-gray-700">{label} — {d.headcount} volunteers</div>
                      {Array.isArray(d.members) && d.members.length>0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {d.members.map(m => (
                            <span key={`${d.id}-${m.user_id}`} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs">
                              {m.user_full_name || m.full_name || m.user_name || m.name || m.username || m.user_email || m.email || `User ${m.user_id}`}
                              {m.role_label ? <em className="text-gray-500">({m.role_label})</em> : null}
                            </span>
                          ))}
                        </div>
                      )}
                      {d.capabilities && <div className="text-gray-600">{d.capabilities}</div>}
                      {d.note && <div className="text-gray-600">{d.note}</div>}
                      <div className="text-xs text-gray-500">
                        {new Date(d.created_at).toLocaleString()} • <span className={`inline-block px-1 rounded ${status==='active'?'bg-yellow-100 text-yellow-800':status==='completed'?'bg-emerald-100 text-emerald-800':'bg-gray-100 text-gray-700'}`}>{status}</span>
                        {by ? ` • by ${by}` : ''}
                      </div>
                    </div>
                    {canAct && (
                      <div className="flex items-center gap-2">
                        <button
                          disabled={actionId===d.id}
                          onClick={()=>updateStatus(d.id, 'completed')}
                          className="px-2 py-1 text-xs bg-emerald-600 text-white rounded disabled:opacity-50"
                        >{actionId===d.id ? 'Updating…' : 'Complete'}</button>
                        <button
                          disabled={actionId===d.id}
                          onClick={()=>updateStatus(d.id, 'withdrawn')}
                          className="px-2 py-1 text-xs bg-gray-700 text-white rounded disabled:opacity-50"
                        >{actionId===d.id ? 'Updating…' : 'Withdraw'}</button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="mt-2 text-xs text-gray-500">Tip: If you see “forbidden”, make sure you have joined this crisis as a participant.</div>
    </div>
  );
}

// Simple searchable multi-select with create-on-enter; keeps UI self-contained.
function SearchableMultiSelect({ options, value, onChange, placeholder, onCreate, allowCreate=false }) {
  const [query, setQuery] = useState('');
  const lowerQuery = query.toLowerCase();
  const filtered = useMemo(() => {
    const base = Array.isArray(options) ? options : [];
    if (!lowerQuery) return base.slice(0, 100);
    return base.filter(o => String(o).toLowerCase().includes(lowerQuery)).slice(0, 100);
  }, [options, lowerQuery]);

  function add(item) {
    const it = String(item || '').trim();
    if (!it) return;
    const current = Array.isArray(value) ? value : [];
    if (!current.includes(it)) onChange([...current, it]);
    setQuery('');
  }

  function remove(item) {
    const current = Array.isArray(value) ? value : [];
    onChange(current.filter(i => i !== item));
  }

  return (
    <div className="mt-1">
      <div className="flex flex-wrap gap-1 mb-2">
        {(value||[]).map(v => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs">
            {v}
            <button type="button" className="text-gray-500 hover:text-gray-700" onClick={()=>remove(v)}>×</button>
          </span>
        ))}
      </div>
      <input
        value={query}
        onChange={e=>setQuery(e.target.value)}
        onPaste={e=>{
          const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
          if (text && /[,;\n]/.test(text)) {
            e.preventDefault();
            const parts = text.split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
            for (const part of parts) { if (allowCreate && onCreate) onCreate(part); }
            setQuery('');
          }
        }}
        onKeyDown={e=>{
          if (e.key === 'Enter') {
            e.preventDefault();
            if (allowCreate && onCreate) onCreate(query);
          }
        }}
        placeholder={placeholder}
        className="w-full border rounded px-3 py-2"
      />
      <div className="mt-1 max-h-40 overflow-auto border rounded">
        {(() => {
          const trimmed = query.trim();
          const current = Array.isArray(value) ? value : [];
          const canCreate = !!trimmed && !current.includes(trimmed) && !!onCreate && !!allowCreate;
          return (
            <>
              {canCreate && (
                <button type="button" onClick={()=>{ if (onCreate) onCreate(trimmed); else add(trimmed); }} className="w-full text-left px-3 py-2 text-sm bg-blue-50 hover:bg-blue-100">
                  Add “{trimmed}”
                </button>
              )}
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-gray-500">No matches</div>
              ) : (
                filtered.map(opt => (
                  <button key={opt} type="button" onClick={()=>add(opt)} className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                    {opt}
                  </button>
                ))
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
