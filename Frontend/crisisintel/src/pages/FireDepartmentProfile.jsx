import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';

export default function FireDepartmentProfile() {
  const { id } = useParams();
  const me = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('me') || 'null'); } catch { return null; }
  }, []);
  const [dept, setDept] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requests, setRequests] = useState([]);
  const [reqLoading, setReqLoading] = useState(true);
  const [reqError, setReqError] = useState(null);
  const [teams, setTeams] = useState([]);
  const [staff, setStaff] = useState([]);
  const [rosterLoading, setRosterLoading] = useState(true);
  const [rosterError, setRosterError] = useState(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestBody, setRequestBody] = useState('');
  const [requestLat, setRequestLat] = useState('');
  const [requestLng, setRequestLng] = useState('');
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestMsg, setRequestMsg] = useState(null);
  const [dmOpen, setDmOpen] = useState(false);
  const [dmBody, setDmBody] = useState('');
  const [dmBusy, setDmBusy] = useState(false);
  const [owner, setOwner] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);
  const deptId = Number(id);

  useEffect(() => {
    let mounted = true;
    setLoading(true); setError(null);
    api.getFireDepartment(deptId)
      .then(async d => {
        if (!mounted) return;
        setDept(d);
        // Fetch owner public to know follow state
        if (d?.user_id) {
          try { const op = await api.getUserPublic(d.user_id); if (mounted) setOwner(op || null); }
          catch(_) { /* ignore */ }
        } else { setOwner(null); }
      })
      .catch(e => { if (mounted) setError(e.message || 'Failed to load'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [deptId]);

  useEffect(() => {
    let mounted = true;
    setRosterLoading(true); setRosterError(null);
    Promise.all([
      api.listFireTeams(deptId).catch(() => ({ items: [] })),
      api.listFireStaff(deptId).catch(() => ({ items: [] })),
    ]).then(([t, s]) => {
      if (!mounted) return;
      setTeams(Array.isArray(t?.items) ? t.items : (Array.isArray(t?.results) ? t.results : []));
      setStaff(Array.isArray(s?.items) ? s.items : (Array.isArray(s?.results) ? s.results : []));
    }).catch(e => {
      if (mounted) setRosterError(e.message || 'Failed to load roster');
    }).finally(() => { if (mounted) setRosterLoading(false); });
    return () => { mounted = false; };
  }, [deptId]);

  useEffect(() => {
    let mounted = true;
    setReqLoading(true); setReqError(null);
    // Pull a page of all fire requests, then filter to this department
    api.fireRequestsAll()
      .then(r => {
        if (!mounted) return;
        const rows = r.results || r.items || [];
        const filtered = rows.filter(x => Number(x.assigned_department_id) === deptId);
        setRequests(filtered);
      })
      .catch(e => { if (mounted) setReqError(e.message || 'Failed to load activities'); })
      .finally(() => { if (mounted) setReqLoading(false); });
    return () => { mounted = false; };
  }, [deptId]);

  const current = useMemo(() => (requests || []).filter(r => r.status && !['completed','resolved','cancelled'].includes(String(r.status))), [requests]);
  const past = useMemo(() => (requests || []).filter(r => r.status && ['completed','resolved','cancelled'].includes(String(r.status))), [requests]);

  const mapHref = useMemo(() => {
    if (dept?.lat == null || dept?.lng == null) return null;
    const lat = Number(dept.lat).toFixed(6);
    const lng = Number(dept.lng).toFixed(6);
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }, [dept?.lat, dept?.lng]);

  if (loading) return <div className="p-4 bg-white border border-gray-200 rounded">Loading…</div>;
  if (error) return <div className="p-4 bg-white border border-gray-200 rounded text-red-600">{error}</div>;
  if (!dept) return null;

  const isOwner = me?.id && dept?.user_id && Number(me.id) === Number(dept.user_id);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-4 bg-white border border-gray-200 rounded-lg">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <div className="w-12 h-12 rounded-full bg-orange-600 text-white flex items-center justify-center text-lg font-bold">
              {(dept?.name || 'D')[0]?.toUpperCase?.() || 'D'}
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">{dept?.name || 'Fire Department'}</h1>
              <div className="mt-1 text-sm text-gray-600 flex items-center space-x-2">
                {dept?.lat != null && dept?.lng != null ? (
                  <>
                    <span>Coords: {dept.lat}, {dept.lng}</span>
                    {mapHref && (<a className="text-purple-700 hover:underline" href={mapHref} target="_blank" rel="noreferrer">Open in Maps</a>)}
                  </>
                ) : (
                  <span>Coords: —</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {isOwner && (
              <a href="/fire-teams" className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm">Manage Teams</a>
            )}
            {dept?.user_id && !isOwner && (
              <>
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded text-sm ${owner?.is_following ? 'bg-gray-200' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
                  disabled={followBusy}
                  onClick={async () => {
                    if (!dept?.user_id) return;
                    setFollowBusy(true);
                    try {
                      if (owner?.is_following) await api.unfollowUser(dept.user_id);
                      else await api.followUser(dept.user_id);
                      try { const refreshed = await api.getUserPublic(dept.user_id); setOwner(refreshed || null); } catch {}
                    } catch (e) {
                      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Follow failed' } }));
                    } finally { setFollowBusy(false); }
                  }}
                >{followBusy ? '...' : (owner?.is_following ? 'Unfollow' : 'Follow')}</button>
                <button type="button" className="px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded text-sm" onClick={() => setDmOpen(v => !v)}>
                  {dmOpen ? 'Close' : 'Message Owner'}
                </button>
              </>
            )}
          </div>
        </div>

        {dmOpen && dept?.user_id && (
          <form
            className="mt-3 flex items-center space-x-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const body = dmBody.trim(); if (!body) return;
              setDmBusy(true);
              try {
                await api.sendDirectMessage(dept.user_id, body);
                setDmBody(''); setDmOpen(false);
                window.dispatchEvent(new CustomEvent('toast', { detail: { type: 'success', message: 'Message sent' }}));
              } catch (err) {
                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to send' } }));
              } finally { setDmBusy(false); }
            }}
          >
            <input
              className="flex-1 p-2 bg-gray-100 rounded border border-gray-200"
              placeholder="Write a message…"
              value={dmBody}
              onChange={e => setDmBody(e.target.value)}
              disabled={dmBusy}
            />
            <button type="submit" className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm" disabled={dmBusy || !dmBody.trim()}>
              {dmBusy ? 'Sending…' : 'Send'}
            </button>
          </form>
        )}
      </div>

      {/* Activity */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Current Deployments</h3>
            <button
              type="button"
              className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
              onClick={() => {
                setReqLoading(true); setReqError(null);
                api.fireRequestsAll().then(r => {
                  const rows = r.results || r.items || [];
                  const filtered = rows.filter(x => Number(x.assigned_department_id) === deptId);
                  setRequests(filtered);
                }).catch(e => setReqError(e.message || 'Failed to refresh')).finally(() => setReqLoading(false));
              }}
            >{reqLoading ? '...' : 'Refresh'}</button>
          </div>
          {reqError && <div className="text-xs text-red-600 mb-2">{reqError}</div>}
          {reqLoading && <div className="text-xs text-gray-500">Loading…</div>}
          {!reqLoading && current.length === 0 && (
            <div className="text-xs text-gray-500">No active deployments.</div>
          )}
          <ul className="space-y-3 max-h-80 overflow-auto pr-1">
            {current.map(a => (
              <li key={a.id} className="p-2 bg-gray-50 border border-gray-200 rounded text-[11px] space-y-1">
                <div className="flex items-start justify-between">
                  <div className="flex-1 pr-2">
                    <p className="font-semibold">#{a.id} <span className="text-[10px] text-gray-500">{a.assigned_team_at ? new Date(a.assigned_team_at).toLocaleString() : new Date(a.created_at).toLocaleString()}</span></p>
                    <p className="whitespace-pre-line">{(a.description||'').slice(0,120)}{(a.description||'').length>120?'…':''}</p>
                    {a.assigned_team_name && <p className="text-[10px] text-gray-500">Team: {a.assigned_team_name}</p>}
                  </div>
                  <div className="text-[10px] font-semibold text-indigo-700">{a.status}</div>
                </div>
                <div className="text-[11px]"><a className="text-purple-700 hover:underline" href={`/fire/requests/${a.id}`}>View details</a></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <h3 className="text-lg font-semibold mb-3">Past Deployments</h3>
          {reqLoading && <div className="text-xs text-gray-500">Loading…</div>}
          {!reqLoading && past.length === 0 && (
            <div className="text-xs text-gray-500">No past deployments.</div>
          )}
          <ul className="space-y-3 max-h-80 overflow-auto pr-1">
            {past.map(a => (
              <li key={a.id} className="p-2 bg-gray-50 border border-gray-200 rounded text-[11px] space-y-1">
                <div className="flex items-start justify-between">
                  <div className="flex-1 pr-2">
                    <p className="font-semibold">#{a.id} <span className="text-[10px] text-gray-500">{a.completed_at ? new Date(a.completed_at).toLocaleString() : (a.assigned_team_at ? new Date(a.assigned_team_at).toLocaleString() : new Date(a.created_at).toLocaleString())}</span></p>
                    <p className="whitespace-pre-line">{(a.description||'').slice(0,120)}{(a.description||'').length>120?'…':''}</p>
                    {a.assigned_team_name && <p className="text-[10px] text-gray-500">Team: {a.assigned_team_name}</p>}
                  </div>
                  <div className={`text-[10px] font-semibold ${a.status==='cancelled' ? 'text-red-700' : 'text-green-700'}`}>{a.status}</div>
                </div>
                <div className="text-[11px]"><a className="text-purple-700 hover:underline" href={`/fire/requests/${a.id}`}>View details</a></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold">Teams & Staff</h3>
            <button
              type="button"
              className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
              onClick={() => {
                setRosterLoading(true); setRosterError(null);
                Promise.all([
                  api.listFireTeams(deptId).catch(() => ({ items: [] })),
                  api.listFireStaff(deptId).catch(() => ({ items: [] })),
                ]).then(([t, s]) => {
                  setTeams(Array.isArray(t?.items) ? t.items : (Array.isArray(t?.results) ? t.results : []));
                  setStaff(Array.isArray(s?.items) ? s.items : (Array.isArray(s?.results) ? s.results : []));
                }).catch(e => setRosterError(e.message || 'Failed to refresh')).finally(() => setRosterLoading(false));
              }}
            >{rosterLoading ? '...' : 'Refresh'}</button>
          </div>
          {rosterError && <div className="text-xs text-red-600 mb-2">{rosterError}</div>}
          {rosterLoading && <div className="text-xs text-gray-500">Loading…</div>}
          {!rosterLoading && (
            <div className="space-y-3">
              <div>
                <div className="text-[13px] font-semibold mb-1">Teams</div>
                {teams.length === 0 && <div className="text-xs text-gray-500">No teams.</div>}
                <ul className="space-y-1 max-h-40 overflow-auto pr-1">
                  {teams.map(t => (
                    <li key={t.id} className="text-sm flex items-center justify-between">
                      <span className="truncate">{t.name || `Team #${t.id}`}</span>
                      {typeof t.member_count === 'number' && <span className="text-[11px] text-gray-500">{t.member_count} members</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-[13px] font-semibold mb-1">Staff</div>
                {staff.length === 0 && <div className="text-xs text-gray-500">No staff.</div>}
                <ul className="space-y-1 max-h-40 overflow-auto pr-1">
                  {staff.map(s => (
                    <li key={s.id} className="text-sm flex items-center justify-between">
                      <a className="truncate text-purple-700 hover:underline" href={`/users/${s.user_id}`}>{s.user_full_name || `User #${s.user_id}`}</a>
                      {s.role && <span className="text-[11px] text-gray-500">{s.role}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {!isOwner && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold">Request this Department</h4>
                <button type="button" className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded" onClick={() => setRequestOpen(v => !v)}>
                  {requestOpen ? 'Close' : 'Open'}
                </button>
              </div>
              {requestOpen && (
                <form
                  className="space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const desc = requestBody.trim(); if (!desc) return;
                    setRequestBusy(true); setRequestMsg(null);
                    try {
                      await api.createFireRequestToDepartment(deptId, desc, requestLat === '' ? undefined : parseFloat(requestLat), requestLng === '' ? undefined : parseFloat(requestLng));
                      setRequestBody(''); setRequestLat(''); setRequestLng(''); setRequestMsg('Request sent');
                      setTimeout(() => setRequestMsg(null), 2500);
                    } catch (err) {
                      setRequestMsg(err.message || 'Failed to send');
                    } finally {
                      setRequestBusy(false);
                    }
                  }}
                >
                  <textarea
                    className="w-full p-2 bg-gray-100 rounded border border-gray-200"
                    rows={3}
                    placeholder="Describe the emergency"
                    value={requestBody}
                    onChange={e => setRequestBody(e.target.value)}
                    disabled={requestBusy}
                  />
                  <div className="flex items-center space-x-2">
                    <input className="flex-1 p-2 bg-gray-100 rounded border border-gray-200" placeholder="Latitude (optional)" value={requestLat} onChange={e => setRequestLat(e.target.value)} disabled={requestBusy} />
                    <input className="flex-1 p-2 bg-gray-100 rounded border border-gray-200" placeholder="Longitude (optional)" value={requestLng} onChange={e => setRequestLng(e.target.value)} disabled={requestBusy} />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <button type="button" className="px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => {
                      if (!navigator.geolocation) return setRequestMsg('Geolocation not supported');
                      navigator.geolocation.getCurrentPosition(p => { setRequestLat(p.coords.latitude.toFixed(6)); setRequestLng(p.coords.longitude.toFixed(6)); }, err => setRequestMsg(err.message || 'Location error'), { enableHighAccuracy: true, timeout: 8000 });
                    }} disabled={requestBusy}>Use My Location</button>
                    <button type="submit" className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm" disabled={requestBusy || !requestBody.trim()}>{requestBusy ? 'Sending…' : 'Send Request'}</button>
                  </div>
                  {requestMsg && <div className={`text-xs ${requestMsg==='Request sent' ? 'text-green-700':'text-red-600'}`}>{requestMsg}</div>}
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
