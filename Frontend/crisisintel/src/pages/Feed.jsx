import React, { useEffect, useState, useCallback } from 'react';
import api from '../api';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { formatDateTime, fromNow, statusVariant } from '../utils/datetime';

/**
 * Unified feed page.
 *
 * Responsibilities:
 *  - Fetch & render combined post + share feed (api.newsFeed)
 *  - Compose & create new posts (with optional image upload preview)
 *  - Inline edit/delete for posts
 *  - Share existing posts with optional note + edit/delete share note
 *  - Lazy load comments per post/share feed row; inline CRUD for own comments
 *  - Display local user stats (post/share counts) pulled from api.myStats
 *
 * State maps (object dictionaries) are used instead of multiple components to limit
 * re-renders and keep logic colocated:
 *  posts: array of feed items (each item either original post or share wrapper)
 *  openComments: { feedKey -> bool } toggles comment pane visibility per row
 *  commentsMap: { post_id -> [comment objects] } caches fetched comments
 *  newComment: { feedKey -> draft text } draft text for adding comment to a post
 *  shareText: { feedKey -> draft text } draft note when composing a share
 *  shareBusy: { feedKey -> bool } loading spinner flag for share submission
 *  editComment: { comment_id -> draft body } open comment editor content
 *  editBusy: { comment_id -> bool } comment save spinner
 *  editPost: { post_id -> { body, image_url } } open post editor draft
 *  editPostBusy: { post_id -> bool } post save spinner
 *  editShare: { share_id -> { comment } } open share note editor draft
 *  editShareBusy: { share_id -> bool } share note save spinner
 *
 * feedKey pattern: 'post-<post_id>' or 'share-<share_id>' ensures uniqueness among
 * rows referencing the same underlying post.
 */
export default function Feed() {
  const [posts, setPosts] = useState([]);
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const isFireService = typeof me?.role === 'string' && me.role.toLowerCase().includes('fire');
  const isHospital = typeof me?.role === 'string' && me.role.toLowerCase().includes('hospital');
  const isBloodBank = typeof me?.role === 'string' && me.role.toLowerCase().includes('blood');
  // Social Organization users (NGO / social service)
  const isSocialOrg = typeof me?.role === 'string' && (
    me.role.toLowerCase().includes('ngo') ||
    me.role.toLowerCase().includes('social') ||
    me.role.toLowerCase().includes('org')
  );
  const [myPostCount, setMyPostCount] = useState(0);
  const [myShareCount, setMyShareCount] = useState(0);
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [openComments, setOpenComments] = useState({}); // feedKey => bool (post-<id> or share-<id>)
  const [commentsMap, setCommentsMap] = useState({});   // post_id => array
  const [newComment, setNewComment] = useState({});     // feedKey => text
  const [shareText, setShareText] = useState({});       // feedKey => text
  const [shareBusy, setShareBusy] = useState({});       // feedKey => bool
  const [editComment, setEditComment] = useState({});   // comment_id => body (for editing)
  const [editBusy, setEditBusy] = useState({});         // comment_id => bool
  const [editPost, setEditPost] = useState({});         // post_id => { body, image_url }
  const [editPostBusy, setEditPostBusy] = useState({}); // post_id => bool
  const [editShare, setEditShare] = useState({});       // share_id => { comment }
  const [editShareBusy, setEditShareBusy] = useState({}); // share_id => bool
  // Pending fire help requests panel state (fire_service only)
  const [showPendingFire, setShowPendingFire] = useState(false);
  const [pendingFireLoading, setPendingFireLoading] = useState(false);
  const [pendingFireError, setPendingFireError] = useState(null);
  const [pendingFireRequests, setPendingFireRequests] = useState([]);
  const [pendingFireCount, setPendingFireCount] = useState(0);
  const [teamsCache, setTeamsCache] = useState([]); // fire teams (fetch lazily when panel opens)
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [deployBusy, setDeployBusy] = useState({}); // request_id => bool
  const [deployMsg, setDeployMsg] = useState({}); // request_id => message
  // Activities (fire service deployments) – now shown in right sidebar
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState(null);
  const [currentActivities, setCurrentActivities] = useState([]);
  const [pastActivities, setPastActivities] = useState([]);
  const [completeBusy, setCompleteBusy] = useState({}); // request_id => bool
  // Regular user fire request compose state
  const isRegular = !isFireService && !isHospital && !isBloodBank && !isSocialOrg; // exclude special roles from regular bucket
  const [showFireForm, setShowFireForm] = useState(false);
  const [fireDesc, setFireDesc] = useState('');
  const [fireLat, setFireLat] = useState('');
  const [fireLng, setFireLng] = useState('');
  const [fireBusy, setFireBusy] = useState(false);
  const [fireSuccess, setFireSuccess] = useState(null); // {id,candidate_id}
  const [fireError, setFireError] = useState(null);
  // Regular user own fire requests view
  const [myFirePanelOpen, setMyFirePanelOpen] = useState(false);
  const [myFireLoading, setMyFireLoading] = useState(false);
  const [myFireError, setMyFireError] = useState(null);
  const [myFireRequests, setMyFireRequests] = useState([]);
  // Appointments sidebar removed in favor of navbar shortcut to /appointments/mine
  // Service bookings sidebar for regular users
  const [svcLoading, setSvcLoading] = useState(false);
  const [svcError, setSvcError] = useState(null);
  const [svcUpcoming, setSvcUpcoming] = useState([]);
  const [svcBusy, setSvcBusy] = useState({}); // booking_id => bool
  const [svcUpcomingOpen, setSvcUpcomingOpen] = useState(() => (typeof window !== 'undefined' ? (localStorage.getItem('svcUpcomingOpen') !== '0') : true));


  const loadServiceBookings = useCallback(async () => {
    if (!isRegular) return;
    setSvcError(null); setSvcLoading(true);
    try {
      const r = await api.myServiceBookings();
      const list = r.results || r.items || [];
      const now = new Date();
      const FUTURE_EPS_MS = 10 * 60 * 1000; // treat within next 10 minutes as upcoming
      const parseWhen = (s) => {
        if (!s) return null;
        // Prefer ISO; if not ISO, replace space with 'T'
        if (typeof s === 'string' && s.includes(' ') && !s.includes('T')) {
          const iso = s.replace(' ', 'T');
          // Treat backend DATETIME (no TZ) as UTC to avoid local skew
          const d = new Date(iso + 'Z');
          if (!isNaN(d)) return d;
        }
        const d = new Date(s);
        return isNaN(d) ? null : d;
      };
      const parsed = list.map(s => ({ ...s, _t: parseWhen(s.scheduled_at) }));
      const upTimeBased = parsed.filter(s => s._t && (s._t - now) >= -FUTURE_EPS_MS);
      upTimeBased.sort((a,b)=> (a._t?.getTime?.() || 0) - (b._t?.getTime?.() || 0));

      // Force-include Ambulance bookings regardless of time
      const isAmb = (x) => String(x.service_name||'').toLowerCase().includes('ambulance');
      const ambAll = parsed.filter(isAmb);
      // Add most recent 1-3 ambulances not already in upcoming
      const upIds = new Set(upTimeBased.map(x => x.id));
      const ambToAdd = ambAll
        .filter(x => !upIds.has(x.id))
        .sort((a,b) => (b._t?.getTime?.() || 0) - (a._t?.getTime?.() || 0))
        .slice(0, 3)
        .map(x => ({ ...x, _forceAmb: true }));
      const merged = [...ambToAdd, ...upTimeBased];
      setSvcUpcoming(merged.slice(0,10));
    } catch (e) {
      setSvcError(e.message || 'Failed to load service bookings');
    } finally { setSvcLoading(false); }
  }, [isRegular]);

  useEffect(() => { if (isRegular) { /* appointments moved */ loadServiceBookings(); } }, [isRegular, loadServiceBookings]);
  // appointments-changed handler not needed on feed anymore
  useEffect(() => {
    const h = () => { if (isRegular) loadServiceBookings(); };
    window.addEventListener('service-bookings-changed', h);
    return () => window.removeEventListener('service-bookings-changed', h);
  }, [isRegular, loadServiceBookings]);

  const loadMyFire = async () => {
    setMyFireError(null); setMyFireLoading(true);
    try {
      const r = await api.myFireRequests();
      setMyFireRequests(r.results || r.items || []);
    } catch (e) {
      setMyFireError(e.message || 'Failed to load');
    } finally { setMyFireLoading(false); }
  };

  // Listen for deploy refresh events (fire service triggers after deployment)
  useEffect(() => {
    const handler = () => {
      if (isRegular && myFirePanelOpen) loadMyFire();
    };
    window.addEventListener('fire-request-deployed', handler);
    return () => window.removeEventListener('fire-request-deployed', handler);
  }, [isRegular, myFirePanelOpen]);
  // Fire service department management
  const [myDepartments, setMyDepartments] = useState([]); // all departments (will filter ownership)
  const [deptLoading, setDeptLoading] = useState(false);
  const [deptError, setDeptError] = useState(null);
  const [deptEditOpen, setDeptEditOpen] = useState(false);
  const [deptDraft, setDeptDraft] = useState({ id: null, name: '', lat: '', lng: '' });
  const [deptSaveBusy, setDeptSaveBusy] = useState(false);
  const [deptSaveMsg, setDeptSaveMsg] = useState(null);
  // Compute owned department id (after myDepartments & deptDraft defined)
  const ownedDeptId = (myDepartments.find(d => d.user_id === me?.id)?.id) || deptDraft.id || null;

  // Load fire departments for fire service user
  useEffect(() => {
    if (!isFireService) return;
    let cancelled = false;
    (async () => {
      setDeptLoading(true); setDeptError(null);
      try {
        const r = await api.listFireDepartments();
        if (cancelled) return;
        const list = r.results || [];
        setMyDepartments(list);
        // Auto-select the first department owned by me (if any)
        const owned = list.filter(d => d.user_id === me?.id);
        if (owned.length > 0) {
          const d0 = owned[0];
            setDeptDraft({ id: d0.id, name: d0.name || '', lat: d0.lat ?? '', lng: d0.lng ?? '' });
        }
      } catch (e) {
        if (!cancelled) setDeptError(e.message || 'Failed to load departments');
      } finally {
        if (!cancelled) setDeptLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isFireService, me?.id]);

  const captureGeo = () => {
    if (!navigator.geolocation) {
      setFireError('Geolocation not supported in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition((pos) => {
      setFireLat(pos.coords.latitude.toFixed(6));
      setFireLng(pos.coords.longitude.toFixed(6));
    }, (err) => {
      setFireError(err.message || 'Unable to obtain location');
    }, { enableHighAccuracy: true, timeout: 8000 });
  };

  const submitFireRequest = async (e) => {
    e.preventDefault();
    if (!fireDesc.trim()) {
      setFireError('Description required');
      return;
    }
    setFireBusy(true); setFireError(null); setFireSuccess(null);
    try {
      const latVal = fireLat === '' ? undefined : parseFloat(fireLat);
      const lngVal = fireLng === '' ? undefined : parseFloat(fireLng);
      const r = await api.createFireRequest(fireDesc.trim(), latVal, lngVal);
      setFireSuccess(r);
      setFireDesc(''); setFireLat(''); setFireLng('');
    } catch (err) {
      setFireError(err.message || 'Request failed');
    } finally {
      setFireBusy(false);
    }
  };

  const loadPendingFire = async () => {
    setPendingFireError(null);
    setPendingFireLoading(true);
    try {
      const r = await api.fireRequests('pending');
      setPendingFireRequests(r.results || []);
      setPendingFireCount((r.results || []).length);
    } catch (e) {
      setPendingFireError(e.message || 'Failed to load');
    } finally {
      setPendingFireLoading(false);
    }
  };

  const loadActivities = useCallback(async () => {
    if (!isFireService) return;
    setActivitiesError(null); setActivitiesLoading(true);
    try {
      const r = await api.fireActivities();
      setCurrentActivities(r.current || []);
      setPastActivities(r.past || []);
    } catch (e) {
      setActivitiesError(e.message || 'Failed to load activities');
    } finally { setActivitiesLoading(false); }
  }, [isFireService]);

  // Initial load for fire service activity log
  useEffect(() => { if (isFireService) loadActivities(); }, [isFireService, loadActivities]);
  // Refresh on deployment/completion events
  useEffect(() => {
    if (!isFireService) return;
    const refresh = () => loadActivities();
    window.addEventListener('fire-request-deployed', refresh);
    window.addEventListener('fire-request-completed', refresh);
    return () => { window.removeEventListener('fire-request-deployed', refresh); window.removeEventListener('fire-request-completed', refresh); };
  }, [isFireService, loadActivities]);

  // lazy load teams (reuse existing /fire-teams page endpoint path guess) - if not present, quietly ignore
  const loadTeams = async () => {
    if (!ownedDeptId) return; // no department yet
    if (teamsCache.length || teamsLoading) return;
    setTeamsLoading(true);
    try {
      const data = await api.listFireTeams(ownedDeptId);
      setTeamsCache(data.items || data.results || []);
    } catch(_) { /* ignore */ }
    setTeamsLoading(false);
  };

  // Initial fetch of pending count (without opening panel) for badge
  useEffect(() => {
    if (isFireService) {
      (async () => {
        try {
          const r = await api.fireRequests('pending');
          setPendingFireCount((r.results || []).length);
          // Do not overwrite list if user later opens; keep minimal footprint
        } catch (_) { /* ignore count errors */ }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFireService]);
  // simplified: remove shareDone/openShares/sharesMap and feed-level search state

  useEffect(() => {
    // Initial bootstrap: feed items + user stats
    api.newsFeed().then(r => setPosts(r.results));
    api.myStats().then(s => { setMyPostCount(s.posts || 0); setMyShareCount(s.shares || 0); }).catch(() => { setMyPostCount(0); setMyShareCount(0); });
  }, []);

  // Close any open comment/share boxes when clicking outside
  useEffect(() => {
    const onDocClick = (e) => {
      // If click is inside any element marked to keep open, skip closing
      if (e.target.closest && e.target.closest('[data-keepopen]')) return;
      setOpenComments({});
      setShareText({});
    };
    // Use bubble phase so inner capture handlers can stop propagation
    document.addEventListener('click', onDocClick, false);
    return () => document.removeEventListener('click', onDocClick, false);
  }, []);

  // feed-level search removed; use navbar search page instead

  const createPost = async (e) => {
    e.preventDefault();
    if (!body.trim() && !imageUrl.trim()) return;
    await api.createPost(body, imageUrl || undefined);
    setBody(''); setImageUrl('');
    const r = await api.newsFeed();
    setPosts(r.results);
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('csrfToken');
    localStorage.removeItem('me');
    window.location.href = '/';
  };

  const onSaveShare = async (item) => {
    // Save edited share note; refresh feed after optimistic local update
    const sid = item.share_id;
    const draft = editShare[sid] || { comment: '' };
    const comment = (draft.comment || '').trim();
    if ((item.share_comment || '') === comment) {
      setEditShare(prev => { const n = { ...prev }; delete n[sid]; return n; });
      return;
    }
    console.debug('[UI] Save share clicked', { share_id: sid, comment });
    setEditShareBusy(prev => ({ ...prev, [sid]: true }));
    try {
      await api.updateShare(sid, comment);
      setPosts(prev => prev.map(x => x.share_id === sid ? ({ ...x, share_comment: comment }) : x));
      setEditShare(prev => { const n = { ...prev }; delete n[sid]; return n; });
      const r = await api.newsFeed();
      setPosts(r.results);
    } catch (err) {
      console.error('Update share failed', err);
      setEditShare(prev => ({ ...prev, [sid]: { ...(prev[sid]||{}), error: err?.message || 'Failed to save share' } }));
    } finally {
      setEditShareBusy(prev => ({ ...prev, [sid]: false }));
    }
  };

  return (
    <div className="grid grid-cols-4 gap-4">
      <div className="main-left col-span-1">
        <div className="p-4 bg-white border border-gray-200 text-center rounded-lg">
          {me?.avatar_url ? (
            <img src={me.avatar_url} alt="avatar" className="mb-6 mx-auto w-24 h-24 rounded-full object-cover border" />
          ) : (
            <div className="mb-6 mx-auto w-24 h-24 rounded-full bg-purple-600 text-white flex items-center justify-center text-2xl font-bold">
              {me?.full_name?.[0]?.toUpperCase?.() || 'U'}
            </div>
          )}
          <p className="font-semibold">{me?.full_name || 'Guest'}</p>
          <p className="text-xs text-gray-500">{me?.email || ''}</p>

          <div className="mt-6 flex space-x-8 justify-around text-xs text-gray-500">
            <p>—</p>
            <p>{myPostCount} posts · {myShareCount} shares</p>
          </div>
          {/* Service Bookings: Upcoming (regular users only) */}
          {isRegular && (
            <>
              <button
                type="button"
                className={`w-full py-2 px-4 ${svcUpcomingOpen ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-indigo-500 hover:bg-indigo-600'} text-white rounded-lg text-sm mt-4`}
                onClick={() => {
                  const next = !svcUpcomingOpen;
                  setSvcUpcomingOpen(next);
                  try { localStorage.setItem('svcUpcomingOpen', next ? '1' : '0'); } catch(_){ }
                }}
              >{svcUpcomingOpen ? 'Hide Upcoming Services' : 'Upcoming Services'}</button>

              {svcUpcomingOpen && (
                <div className="p-4 bg-white border border-gray-200 rounded-lg mt-4" data-keepopen>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xl">Upcoming Services</h3>
                    <div className="flex items-center gap-2">
                      <button
                        className="px-2 py-1 rounded bg-gray-100 text-xs"
                        onClick={() => loadServiceBookings()}
                        disabled={svcLoading}
                      >{svcLoading ? '...' : 'Refresh'}</button>
                    </div>
                  </div>

                  {svcError && <div className="text-xs text-red-600 mb-2">{svcError}</div>}
                  {svcLoading && <div className="text-xs text-gray-500">Loading…</div>}
                  {!svcLoading && svcUpcoming.length === 0 && (
                    <div className="text-xs text-gray-500">No upcoming services.</div>
                  )}

                  {!svcLoading && svcUpcoming.length > 0 && (
                    <ul className="space-y-3 max-h-72 overflow-auto pr-1">
                      {svcUpcoming.map(s => {
                        const isAmb = String(s.service_name||'').toLowerCase().includes('ambulance');
                        const start = s._t ? new Date(s._t) : new Date(s.scheduled_at);
                        const canCancel = !isAmb && s.status === 'booked' && (start - new Date()) > 2*60*60*1000;
                        return (
                          <li key={s.id} className="p-2 bg-gray-50 border border-gray-200 rounded text-[11px] space-y-1">
                            <div className="flex items-start justify-between">
                              <div className="flex-1 pr-2">
                                {!isAmb ? (
                                  <p className="font-semibold">{formatDateTime(s._t || s.scheduled_at)} <span className="text-gray-500">({fromNow(s._t || s.scheduled_at)})</span></p>
                                ) : (
                                  <p className="font-semibold">Ambulance requested</p>
                                )}
                                <p className="text-gray-700">
                                  <span className="font-medium">{s.service_name || `Service #${s.service_id}`}</span>
                                  {' '}·{' '}
                                  <a className="text-purple-700 hover:underline" href={`/hospitals/${s.hospital_id || s.hospital_user_id}`}>{s.hospital_name || `Hospital #${s.hospital_user_id}`}</a>
                                </p>
                                {s.service_duration_minutes != null && (
                                  <p className="text-gray-700">Duration: {s.service_duration_minutes} min</p>
                                )}
                                {(s.serial != null || s.approx_time) && (
                                  <p className="text-gray-700">
                                    {s.serial != null && <span className="mr-2">Ticket #{s.serial}</span>}
                                    {s.approx_time && <span>Approx: {s.approx_time}</span>}
                                  </p>
                                )}
                              </div>
                              <Badge variant={statusVariant(s.status)}>{String(s.status).replace('_',' ')}</Badge>
                            </div>
                            {(canCancel || s.status !== 'booked' || isAmb) && (
                              <div className="pt-1 flex items-center gap-2">
                                {canCancel && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    loading={!!svcBusy[s.id]}
                                    onClick={async ()=>{
                                      if (!window.confirm('Request to cancel this service booking?')) return;
                                      setSvcBusy(prev => ({ ...prev, [s.id]: true }));
                                      try {
                                        await api.cancelServiceBooking(s.id);
                                        window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Cancel requested' } }));
                                        setSvcUpcoming(prev => prev.map(x => x.id===s.id ? ({ ...x, status:'cancel_requested' }) : x));
                                        window.dispatchEvent(new CustomEvent('service-bookings-changed', { detail: { booking_id: s.id } }));
                                      } catch (e) {
                                        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Cancel failed' } }));
                                      } finally {
                                        setSvcBusy(prev => { const n={...prev}; delete n[s.id]; return n; });
                                      }
                                    }}
                                  >Request cancel</Button>
                                )}
                                {(isAmb || s.status !== 'booked') && (
                                  <Button
                                    size="sm"
                                    variant="danger"
                                    onClick={async ()=>{
                                      if (!window.confirm('Hide this booking from your list?')) return;
                                      setSvcBusy(prev => ({ ...prev, [s.id]: true }));
                                      try {
                                        await api.hideServiceBooking(s.id);
                                        setSvcUpcoming(prev => prev.filter(x => x.id !== s.id));
                                        window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Removed' } }));
                                        window.dispatchEvent(new CustomEvent('service-bookings-changed', { detail: { booking_id: s.id } }));
                                      } catch (e) {
                                        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Remove failed' } }));
                                      } finally {
                                        setSvcBusy(prev => { const n={...prev}; delete n[s.id]; return n; });
                                      }
                                    }}
                                  >Delete</Button>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}

          <div className="mt-4 flex flex-col space-y-2">
            {isFireService && (
              <>
                <button onClick={()=>{ window.location.href='/fire-teams'; }} className="py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm">Fire Teams</button>
                <button
                  onClick={() => setDeptEditOpen(v => !v)}
                  className="py-2 px-4 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm"
                >{deptEditOpen ? 'Close Department Location' : 'Edit Dept Location'}</button>
                <button
                  onClick={() => {
                    setShowPendingFire(v => {
                      const next = !v;
                      if (!v) {
                        // Opening: refresh list & count
                        loadPendingFire();
                      }
                      return next;
                    });
                  }}
                  className="relative py-2 px-4 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm"
                >
                  {showPendingFire ? 'Hide Pending Help' : 'Pending Help Requests'}
                  {pendingFireCount > 0 && !showPendingFire && (
                    <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 py-0.5 bg-red-600 rounded-full flex items-center justify-center text-[10px] font-semibold shadow" title={`${pendingFireCount} pending`}>{pendingFireCount}</span>
                  )}
                </button>
              </>
            )}
            {isSocialOrg && (
              <>
                <button onClick={()=>{ window.location.href='/social-org/campaigns'; }} className="py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm">Campaigns</button>
                <button onClick={()=>{ window.location.href='/social-org/volunteers'; }} className="py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm">Volunteers</button>
                <button onClick={()=>{ window.location.href='/social-org/donations'; }} className="py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm">Donations</button>
              </>
            )}
            {isHospital && (
              <>
                <button onClick={()=>{ window.location.href='/hospital/doctors'; }} className="py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm">Doctors</button>
                <button onClick={()=>{ window.location.href='/hospital/services'; }} className="py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm">Services</button>
              </>
            )}
            {isBloodBank && (
              <>
                <button onClick={()=>{ window.location.href='/blood-bank/donors'; }} className="py-2 px-4 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm">Our Donors</button>
                <button onClick={()=>{ window.location.href='/blood-bank/inventory'; }} className="py-2 px-4 bg-pink-600 hover:bg-pink-700 text-white rounded-lg text-sm">Inventory</button>
                <button onClick={()=>{ window.location.href='/blood-bank/recruit'; }} className="py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm">Recruit Donors</button>
              </>
            )}
            {isRegular && (
              <>
                <button
                  onClick={() => { setShowFireForm(v => !v); setFireError(null); }}
                  className="py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm"
                >
                  {showFireForm ? 'Cancel Fire Request' : 'Request Fire Service'}
                </button>
                <button
                  onClick={() => {
                    setMyFirePanelOpen(v => {
                      const next = !v;
                      if (!v) loadMyFire();
                      return next;
                    });
                  }}
                  className="py-2 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm"
                >{myFirePanelOpen ? 'Hide My Fire Requests' : 'My Fire Requests'}</button>
                {showFireForm && (
                  <form onSubmit={submitFireRequest} className="p-3 bg-gray-50 border border-gray-200 rounded text-left space-y-2" data-keepopen>
                    <textarea
                      className="w-full p-2 bg-white rounded border border-gray-200 text-sm"
                      rows={3}
                      placeholder="Describe the fire / emergency (required)"
                      value={fireDesc}
                      onChange={e => setFireDesc(e.target.value)}
                      disabled={fireBusy}
                    />
                    <div className="flex items-center space-x-2">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Latitude (optional)"
                        className="flex-1 p-2 bg-white rounded border border-gray-200 text-xs"
                        value={fireLat}
                        onChange={e => setFireLat(e.target.value)}
                        disabled={fireBusy}
                      />
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Longitude (optional)"
                        className="flex-1 p-2 bg-white rounded border border-gray-200 text-xs"
                        value={fireLng}
                        onChange={e => setFireLng(e.target.value)}
                        disabled={fireBusy}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <button
                        type="button"
                        className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                        onClick={captureGeo}
                        disabled={fireBusy}
                      >Use My Location</button>
                      <div className="flex items-center space-x-2">
                        <button
                          type="submit"
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs"
                          disabled={fireBusy}
                        >{fireBusy ? 'Submitting...' : 'Submit Request'}</button>
                      </div>
                    </div>
                    {fireError && <div className="text-xs text-red-600">{fireError}</div>}
                    {fireSuccess && (
                      <div className="text-[11px] text-green-700">Created request #{fireSuccess.id}{fireSuccess.candidate_id ? ' (candidate notified)' : ''}</div>
                    )}
                  </form>
                )}
              </>
            )}
            <button onClick={logout} className="py-2 px-4 bg-gray-100 rounded-lg text-sm">Logout</button>
          </div>
          {isFireService && showPendingFire && (
            <div className="mt-6 text-left" data-keepopen>
              <h4 className="text-sm font-semibold mb-2 flex items-center justify-between">
                <span>Pending Help Requests</span>
                <button
                  type="button"
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
                  onClick={() => loadPendingFire()}
                  disabled={pendingFireLoading}
                  data-keepopen
                >
                  {pendingFireLoading ? 'Loading...' : 'Refresh'}
                </button>
              </h4>
              {pendingFireError && (
                <div className="text-xs text-red-600 mb-2" data-keepopen>{pendingFireError}</div>
              )}
              {!pendingFireError && !pendingFireLoading && isFireService && !ownedDeptId && (
                <div className="text-[11px] text-amber-700 mb-2" data-keepopen>
                  You don't own a fire department yet, so no teams are available for deployment. Create a department and teams first.
                </div>
              )}
              {!pendingFireLoading && !pendingFireError && pendingFireRequests.length === 0 && (
                <div className="text-xs text-gray-500" data-keepopen>No pending requests.</div>
              )}
              {pendingFireLoading && (
                <div className="text-xs text-gray-500" data-keepopen>Loading pending requests...</div>
              )}
              <ul className="space-y-3 max-h-64 overflow-auto pr-1" data-keepopen>
                {pendingFireRequests.map(r => {
                  const msg = deployMsg[r.id];
                  return (
                  <li key={r.id} className="p-2 bg-gray-50 border border-gray-200 rounded text-xs space-y-2" data-keepopen>
                    <div className="flex items-start justify-between" data-keepopen>
                      <div className="flex-1 pr-2" data-keepopen>
                        <p className="font-semibold mb-1" data-keepopen>#{r.id} <span className="text-[10px] text-gray-500">{new Date(r.created_at).toLocaleString()}</span></p>
                        <p className="whitespace-pre-line" data-keepopen>{(r.description || '').slice(0,140)}{(r.description||'').length>140?'…':''}</p>
                        {r.lat !== null && r.lng !== null && (
                          <p className="mt-1 text-[10px] text-gray-500" data-keepopen>Location: {r.lat}, {r.lng}</p>
                        )}
                      </div>
                      <div className="text-[10px] text-orange-700 font-semibold" data-keepopen>{r.status}</div>
                    </div>
                    <div className="flex items-center space-x-2" data-keepopen>
                      <select
                        className="flex-1 p-1 border border-gray-300 rounded bg-white"
                        data-keepopen
                        onFocus={loadTeams}
                        defaultValue=""
                        disabled={deployBusy[r.id]}
                        id={`deploy-team-${r.id}`}
                      >
                        <option value="" disabled>{teamsLoading ? 'Loading teams...' : (ownedDeptId ? 'Select team' : 'No department')}</option>
                        {(!teamsLoading && ownedDeptId && teamsCache.length===0) && <option value="" disabled>No teams</option>}
                        {teamsCache.map(t => (
                          <option key={t.id} value={t.id}>{t.name || `Team ${t.id}`}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded"
                        disabled={deployBusy[r.id] || teamsLoading || !ownedDeptId || teamsCache.length===0}
                        onClick={async () => {
                          const select = document.getElementById(`deploy-team-${r.id}`);
                          const team_id = select && select.value ? parseInt(select.value) : null;
                          if (!team_id) { setDeployMsg(m => ({ ...m, [r.id]: 'Pick a team' })); return; }
                          setDeployBusy(b => ({ ...b, [r.id]: true }));
                          setDeployMsg(m => ({ ...m, [r.id]: null }));
                          try {
                            await api.deployFireRequestTeam(r.id, team_id);
                            setDeployMsg(m => ({ ...m, [r.id]: 'Deployed' }));
                            setPendingFireRequests(prev => prev.filter(x => x.id !== r.id));
                            setPendingFireCount(c => Math.max(0, c-1));
                            // Notify regular user panels in other sessions (best effort local) – could be via WebSocket later
                            window.dispatchEvent(new CustomEvent('fire-request-deployed', { detail: { request_id: r.id, team_id } }));
                          } catch (e) {
                            setDeployMsg(m => ({ ...m, [r.id]: e.message || 'Failed' }));
                          } finally {
                            setDeployBusy(b => ({ ...b, [r.id]: false }));
                            setTimeout(()=> setDeployMsg(m => { const n={...m}; delete n[r.id]; return n; }), 3000);
                          }
                        }}
                        data-keepopen
                      >{deployBusy[r.id] ? '...' : 'Deploy'}</button>
                      {msg && <span className={`text-[10px] ${msg==='Deployed' ? 'text-green-700':'text-red-600'}`}>{msg}</span>}
                    </div>
                    {!teamsLoading && ownedDeptId && teamsCache.length===0 && (
                      <div className="text-[10px] text-gray-500 pt-1" data-keepopen>
                        No teams yet. <button type="button" className="underline" onClick={()=>window.location.href='/fire-teams'}>Create one</button>.
                      </div>
                    )}
                  </li>);
                })}
              </ul>
            </div>
          )}
          {isFireService && deptEditOpen && (
            <div className="mt-6 text-left" data-keepopen>
              <h4 className="text-sm font-semibold mb-2 flex items-center justify-between">
                <span>Department Location</span>
                {deptLoading && <span className="text-[10px] text-gray-500">Loading…</span>}
              </h4>
              {deptError && <div className="text-xs text-red-600 mb-2">{deptError}</div>}
              {(!deptDraft.id) && !deptLoading && (
                <div className="text-xs text-gray-600 mb-2">No department owned by you found. Create one first.</div>
              )}
              {deptDraft.id && (
                <form
                  className="space-y-2"
                  data-keepopen
                  onSubmit={async (e)=>{
                    e.preventDefault();
                    if (!deptDraft.id) return;
                    setDeptSaveMsg(null);
                    const payload = { name: deptDraft.name.trim() };
                    const latNum = deptDraft.lat === '' ? null : parseFloat(deptDraft.lat);
                    const lngNum = deptDraft.lng === '' ? null : parseFloat(deptDraft.lng);
                    if (!isNaN(latNum)) payload.lat = latNum; else if (deptDraft.lat === '') payload.lat = null;
                    if (!isNaN(lngNum)) payload.lng = lngNum; else if (deptDraft.lng === '') payload.lng = null;
                    setDeptSaveBusy(true);
                    try {
                      await api.updateFireDepartment(deptDraft.id, payload);
                      setDeptSaveMsg('Saved');
                      // reflect in local cached list
                      setMyDepartments(prev => prev.map(d => d.id === deptDraft.id ? ({ ...d, ...payload }) : d));
                      setTimeout(()=> setDeptSaveMsg(null), 2500);
                    } catch (err) {
                      setDeptSaveMsg(err.message || 'Save failed');
                    } finally {
                      setDeptSaveBusy(false);
                    }
                  }}
                >
                  <div>
                    <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Name</label>
                    <input
                      className="w-full p-2 bg-white border border-gray-200 rounded text-xs"
                      value={deptDraft.name}
                      onChange={e => setDeptDraft(d => ({ ...d, name: e.target.value }))}
                      disabled={deptLoading}
                    />
                  </div>
                  <div className="flex space-x-2">
                    <div className="flex-1">
                      <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Latitude</label>
                      <input
                        className="w-full p-2 bg-white border border-gray-200 rounded text-xs"
                        value={deptDraft.lat === null ? '' : deptDraft.lat}
                        onChange={e => setDeptDraft(d => ({ ...d, lat: e.target.value }))}
                        disabled={deptLoading}
                        placeholder="e.g. 23.8103"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Longitude</label>
                      <input
                        className="w-full p-2 bg-white border border-gray-200 rounded text-xs"
                        value={deptDraft.lng === null ? '' : deptDraft.lng}
                        onChange={e => setDeptDraft(d => ({ ...d, lng: e.target.value }))}
                        disabled={deptLoading}
                        placeholder="e.g. 90.4125"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs pt-1">
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        className="px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded"
                        disabled={deptLoading}
                        onClick={() => {
                          if (!navigator.geolocation) return alert('Geolocation not supported');
                          navigator.geolocation.getCurrentPosition(p => {
                            setDeptDraft(d => ({ ...d, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }));
                          }, err => alert(err.message || 'Failed to get location'), { enableHighAccuracy: true, timeout: 8000 });
                        }}
                      >Use My Location</button>
                      <button
                        type="button"
                        className="px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded"
                        disabled={deptLoading}
                        onClick={() => {
                          // Randomize around Dhaka-ish center (23.81, 90.41) ±0.25
                          const baseLat = 23.8103, baseLng = 90.4125, delta = 0.25;
                          const rand = (min, max) => (Math.random() * (max - min) + min).toFixed(6);
                          setDeptDraft(d => ({ ...d, lat: rand(baseLat-delta, baseLat+delta), lng: rand(baseLng-delta, baseLng+delta) }));
                        }}
                      >Randomize</button>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        type="submit"
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded"
                        disabled={deptLoading || deptSaveBusy || !deptDraft.name.trim()}
                      >{deptSaveBusy ? 'Saving…' : 'Save'}</button>
                      {deptSaveMsg && <span className={`text-[11px] ${deptSaveMsg==='Saved' ? 'text-green-700':'text-red-600'}`}>{deptSaveMsg}</span>}
                    </div>
                  </div>
                </form>
              )}
            </div>
          )}
          {isRegular && myFirePanelOpen && (
            <div className="mt-6 text-left" data-keepopen>
              <h4 className="text-sm font-semibold mb-2 flex items-center justify-between">
                <span>My Fire Requests</span>
                <button
                  type="button"
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
                  onClick={loadMyFire}
                  disabled={myFireLoading}
                  data-keepopen
                >{myFireLoading ? 'Loading...' : 'Refresh'}</button>
              </h4>
              {myFireError && <div className="text-xs text-red-600 mb-2" data-keepopen>{myFireError}</div>}
              {!myFireLoading && !myFireError && myFireRequests.length === 0 && (
                <div className="text-xs text-gray-500" data-keepopen>No requests created yet.</div>
              )}
              {myFireLoading && <div className="text-xs text-gray-500" data-keepopen>Loading...</div>}
              <ul className="space-y-3 max-h-64 overflow-auto pr-1" data-keepopen>
                {myFireRequests.map(r => (
                  <li key={r.id} className="p-2 bg-gray-50 border border-gray-200 rounded text-xs space-y-1" data-keepopen>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 pr-2">
                        <p className="font-semibold mb-1">#{r.id} <span className="text-[10px] text-gray-500">{new Date(r.created_at).toLocaleString()}</span></p>
                        <p className="whitespace-pre-line">{(r.description||'').slice(0,140)}{(r.description||'').length>140?'…':''}</p>
                        {r.lat !== null && r.lng !== null && (
                          <p className="mt-1 text-[10px] text-gray-500">Location: {r.lat}, {r.lng}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end space-y-1">
                        <div className={`text-[10px] font-semibold ${r.status==='assigned' || r.status==='completed' || r.status==='resolved' ? 'text-green-700' : (r.status==='cancelled' ? 'text-red-700' : 'text-orange-700')}`}>{r.status}</div>
                        <button
                          type="button"
                          className="px-2 py-0.5 bg-gray-200 hover:bg-gray-300 rounded text-[10px]"
                          title="Delete from my view"
                          onClick={async ()=>{
                            if(!window.confirm('Remove this request from your list? This will not delete logs for responders.')) return;
                            try {
                              await api.hideFireRequest(r.id);
                              setMyFireRequests(prev => prev.filter(x => x.id !== r.id));
                            } catch(e) {
                              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Delete failed' }}));
                            }
                          }}
                          data-keepopen
                        >Delete</button>
                      </div>
                    </div>
                    {r.status === 'pending' && !r.assigned_department_id && !r.assigned_team_id && (
                      <div className="pt-1" data-keepopen>
                        <button
                          type="button"
                          className="px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded text-[10px]"
                          onClick={async ()=>{
                            if(!window.confirm('Cancel this request?')) return;
                            try {
                              await api.cancelFireRequest(r.id);
                              setMyFireRequests(prev => prev.map(x => x.id===r.id ? { ...x, status:'cancelled' } : x));
                              window.dispatchEvent(new CustomEvent('fire-request-cancelled', { detail: { request_id: r.id }}));
                            } catch(e) {
                              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Cancel failed' }}));
                            }
                          }}
                          data-keepopen
                        >Cancel</button>
                      </div>
                    )}
                    {r.assigned_team_id && (
                      <div className="text-[11px] text-gray-600" data-keepopen>
                        Team: <strong>{r.assigned_team_name || ('Team #' + r.assigned_team_id)}</strong>
                        {r.assigned_team_status && <span> · {r.assigned_team_status}</span>}<br/>
                        {r.assigned_department_id && (
                          <span>
                            Dept: <a className="text-purple-700 hover:underline" href={`/fire-departments/${r.assigned_department_id}`}>{r.assigned_department_name || (`Dept #${r.assigned_department_id}`)}</a>
                          </span>
                        )}
                        {r.assigned_team_at && <span>Deployed: {new Date(r.assigned_team_at).toLocaleString()}</span>}
                      </div>
                    )}
                    {Array.isArray(r.candidate_departments) && (
                      <div className="pt-1 text-[11px] text-gray-600" data-keepopen>
                        <div className="font-semibold mb-0.5">Received by:</div>
                        {r.candidate_departments.length === 0 && (
                          <div className="text-[10px] text-gray-500">— no departments yet —</div>
                        )}
                        {r.candidate_departments.length > 0 && (
                          <ul className="space-y-0.5">
                            {r.candidate_departments.map(cd => {
                              const isAssigned = r.assigned_department_id && cd.department_id === r.assigned_department_id;
                              let color = 'bg-gray-200 text-gray-700';
                              if (cd.status === 'accepted') color = 'bg-green-600 text-white';
                              else if (cd.status === 'declined') color = 'bg-red-600 text-white';
                              else if (cd.status === 'pending') color = 'bg-orange-500 text-white';
                              return (
                                <li key={cd.department_id} className="flex items-center justify-between pr-1">
                                  <a className="truncate text-purple-700 hover:underline" href={`/fire-departments/${cd.department_id}`}>{cd.name || ('Dept #' + cd.department_id)}</a>
                                  <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>
                                    {cd.status}{isAssigned && ' · Assigned'}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <div className="main-center col-span-2 space-y-4">
        <div className="bg-white border border-gray-200 rounded-lg">
          <form onSubmit={createPost} className="p-4 space-y-4">
            <textarea className="p-4 w-full bg-gray-100 rounded-lg" rows={3} value={body} onChange={e=>setBody(e.target.value)} placeholder="What are you thinking about?" />
            <div className="p-4 border-t border-gray-100 space-y-3">
              <div
                className="w-full p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:bg-gray-50"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                onDrop={async (e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files && e.dataTransfer.files[0];
                  if (!file) return;
                  try {
                    const r = await api.uploadImage(file);
                    setImageUrl(r.url);
                  } catch (err) {
                    window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Upload failed' } }));
                  }
                }}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = async () => {
                    const file = input.files && input.files[0];
                    if (!file) return;
                    try {
                      const r = await api.uploadImage(file);
                      setImageUrl(r.url);
                    } catch (err) {
                      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Upload failed' } }));
                    }
                  };
                  input.click();
                }}
                title="Click to upload or drag & drop image"
              >
                {imageUrl ? (
                  <div className="space-y-2">
                    <img src={imageUrl} alt="preview" className="mx-auto max-h-64 rounded" />
                    <div className="text-xs text-gray-500 break-all">{imageUrl}</div>
                    <div>
                      <button type="button" className="text-xs text-red-600" onClick={() => setImageUrl('')}>Remove</button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-600">
                    <div className="flex items-center justify-center space-x-2">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor"><path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-.586-1.414l-5-5A2 2 0 0011 2H4z"/><path d="M8 12l2-2 3 3H5l2.5-3z"/></svg>
                      <span>Click to upload or drag & drop an image</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">PNG, JPG, GIF, WEBP (max 5 MB)</div>
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <button className="inline-block py-3 px-6 bg-purple-600 text-white rounded-lg">Post</button>
              </div>
            </div>
          </form>
        </div>

  {/* feed-level search removed; use navbar search */}

  {posts.map(item => (
          <div
            key={(item.share_id ? `share-${item.share_id}` : `post-${item.post_id}`)}
            className="p-4 bg-white border border-gray-200 rounded-lg"
            data-keepopen
          >
            {/* Header: actor and time */}
            <div className={(item.feed_type === 'post' ? 'mb-6 ' : 'mb-3 ') + 'flex items-center justify-between'}>
              <div className="flex items-center space-x-3">
                {item.actor_avatar_url ? (
                  <img src={item.actor_avatar_url} alt="avatar" className="w-9 h-9 rounded-full object-cover border" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-bold">
                    {(item.actor_name || 'U').trim()[0]?.toUpperCase()}
                  </div>
                )}
                <div className="text-sm">
                  {item.actor_user_id ? (
                    <a className="font-semibold text-purple-700 hover:underline" href={`/users/${item.actor_user_id}`}>{item.actor_name}</a>
                  ) : (
                    <p className="font-semibold">{item.actor_name}</p>
                  )}
                  {item.feed_type === 'share' && (
                    <p className="text-[11px] text-gray-500">shared a post</p>
                  )}
                  {item.feed_type === 'campaign' && (
                    <p className="text-[11px] text-gray-500">updated a campaign</p>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <p className="text-gray-600 text-xs">{new Date(item.item_time).toLocaleString()}</p>
                {item.feed_type !== 'campaign' && String(item.post_author_id) === String(me?.id) && (
                  <div className="flex items-center space-x-2" data-keepopen>
                    {editPost[item.post_id] === undefined ? (
                      <>
                        <button
                          type="button"
                          className="p-1 hover:bg-gray-100 rounded"
                          title="Edit"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditPost(prev => ({ ...prev, [item.post_id]: { body: item.body || '', image_url: item.image_url || '' } })); }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 010 2.828l-8.5 8.5a2 2 0 01-.878.513l-4 1a1 1 0 01-1.213-1.213l1-4a2 2 0 01.513-.878l8.5-8.5a2 2 0 012.828 0z"/><path d="M15 7l-2-2"/></svg>
                        </button>
                        <button
                          type="button"
                          className="p-1 hover:bg-gray-100 rounded"
                          title="Delete"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!window.confirm('Delete this post?')) return;
                            try {
                              await api.deletePost(item.post_id);
                              setPosts(prev => prev.filter(x => x.post_id !== item.post_id));
                              window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Post deleted' } }));
                            } catch (e) {
                              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e?.message || 'Failed to delete post' } }));
                            }
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-1 1v1H5.5a.5.5 0 000 1H6v10a2 2 0 002 2h4a2 2 0 002-2V5h.5a.5.5 0 000-1H12V3a1 1 0 00-1-1H9zm1 4a.75.75 0 011.5 0v8a.75.75 0 01-1.5 0V6zM8 6.75A.75.75 0 019.5 6v8a.75.75 0 01-1.5 0V6.75z" clipRule="evenodd"/></svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="p-1 hover:bg-gray-100 rounded"
                          title="Save"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const draft = editPost[item.post_id] || { body: '', image_url: '' };
                            const body = (draft.body || '').trim();
                            const image_url = (draft.image_url || '').trim() || null;
                            setEditPostBusy(prev => ({ ...prev, [item.post_id]: true }));
                            try {
                              await api.updatePost(item.post_id, body, image_url || undefined);
                              setPosts(prev => prev.map(x => x.post_id === item.post_id ? ({ ...x, body, image_url, post_updated_at: new Date().toISOString() }) : x));
                              setEditPost(prev => { const n = { ...prev }; delete n[item.post_id]; return n; });
                              window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Post updated' } }));
                            } catch (e) {
                              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e?.message || 'Failed to update post' } }));
                            } finally {
                              setEditPostBusy(prev => ({ ...prev, [item.post_id]: false }));
                            }
                          }}
                          disabled={!!editPostBusy[item.post_id]}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-700" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 3.293a1 1 0 010 1.414l-8.147 8.147-3.439 1.146 1.146-3.439 8.147-8.147a1 1 0 011.414 0z"/><path d="M5 13l4 4"/></svg>
                        </button>
                        <button
                          type="button"
                          className="p-1 hover:bg-gray-100 rounded"
                          title="Cancel"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditPost(prev => { const n = { ...prev }; delete n[item.post_id]; return n; }); }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Share note (if any) */}
            {item.feed_type === 'share' && (
              <div className="mb-3" data-keepopen>
                {editShare[item.share_id] === undefined ? (
                  <div className="flex items-start justify-between">
                    <p className="text-sm whitespace-pre-line">{item.share_comment}</p>
                    {(item.share_user_id ? (item.share_user_id === me?.id) : (item.actor_name === me?.full_name)) && (
                      <div className="ml-3 flex items-center space-x-2">
                        <button
                          type="button"
                          className="p-1 hover:bg-gray-100 rounded"
                          title="Edit share note"
                          aria-label="Edit share note"
                          data-keepopen
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditShare(prev => ({ ...prev, [item.share_id]: { comment: item.share_comment || '' } })); }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 010 2.828l-8.5 8.5a2 2 0 01-.878.513l-4 1a1 1 0 01-1.213-1.213l1-4a2 2 0 01.513-.878l8.5-8.5a2 2 0 012.828 0z"/><path d="M15 7l-2-2"/></svg>
                        </button>
                        <button
                          type="button"
                          className="p-1 hover:bg-gray-100 rounded"
                          title="Delete share"
                          aria-label="Delete share"
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!window.confirm('Delete this share?')) return;
                            try {
                              await api.deleteShare(item.share_id);
                              setPosts(prev => prev.filter(x => x.share_id !== item.share_id));
                            } catch (err) {
                              console.error('Delete share failed', err);
                              alert('Could not delete share.');
                            }
                          }}
                          data-keepopen
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-1 1v1H5.5a.5.5 0 000 1H6v10a2 2 0 002 2h4a2 2 0 002-2V5h.5a.5.5 0 000-1H12V3a1 1 0 00-1-1H9zm1 4a.75.75 0 011.5 0v8a.75.75 0 01-1.5 0V6zM8 6.75A.75.75 0 019.5 6v8a.75.75 0 01-1.5 0V6.75z" clipRule="evenodd"/></svg>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2" data-keepopen>
                    <textarea
                      className="w-full p-2 bg-gray-100 rounded"
                      rows={2}
                      value={editShare[item.share_id]?.comment || ''}
                      onChange={e => setEditShare(prev => ({ ...prev, [item.share_id]: { comment: e.target.value } }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          onSaveShare(item);
                        }
                      }}
                    />
                    {editShare[item.share_id]?.error && (
                      <div className="text-xs text-red-600">{editShare[item.share_id].error}</div>
                    )}
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        className="px-2 py-1 hover:bg-gray-100 rounded inline-flex items-center space-x-1"
                        title="Save"
                        aria-label="Save share"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSaveShare(item); }}
                        disabled={!!editShareBusy[item.share_id]}
                        data-keepopen
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-700" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 3.293a1 1 0 010 1.414l-8.147 8.147-3.439 1.146 1.146-3.439 8.147-8.147a1 1 0 011.414 0z"/><path d="M5 13l4 4"/></svg>
                        <span className="text-xs text-green-700">Save</span>
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 hover:bg-gray-100 rounded inline-flex items-center space-x-1"
                        title="Cancel"
                        aria-label="Cancel editing share"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditShare(prev => { const n = { ...prev }; delete n[item.share_id]; return n; }); }}
                        data-keepopen
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                        <span className="text-xs text-gray-700">Cancel</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Content */}
            {item.feed_type === 'share' ? (
              <div className="border border-gray-100 rounded-lg p-3 bg-gray-50" data-keepopen>
                <div className="mb-2 flex items-center space-x-2">
                  {item.original_author_avatar_url ? (
                    <img src={item.original_author_avatar_url} alt="avatar" className="w-7 h-7 rounded-full object-cover border" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-purple-600 text-white flex items-center justify-center text-[10px] font-bold">{(item.original_author_name || 'U').trim()[0]?.toUpperCase()}</div>
                  )}
                  <p className="text-sm">
                    {item.post_author_id ? (
                      <a className="font-semibold text-purple-700 hover:underline" href={`/users/${item.post_author_id}`}>{item.original_author_name}</a>
                    ) : (
                      <strong>{item.original_author_name}</strong>
                    )}
                    <span className="text-xs text-gray-500"> • {new Date(item.original_created_at).toLocaleString()}</span>
                  </p>
                </div>
                {editPost[item.post_id] === undefined ? (
                  <>
                    <p className="whitespace-pre-line text-sm">{item.body}</p>
                    {item.post_updated_at && (
                      <p className="mt-1 text-[11px] text-gray-500">edited · {new Date(item.post_updated_at).toLocaleString()}</p>
                    )}
                    {item.image_url && (
                      <img src={item.image_url} alt="post" className="mt-3 rounded-lg max-h-[420px] object-cover w-full" />
                    )}
                  </>
                ) : (
                  <div className="space-y-3" data-keepopen>
                    <textarea
                      className="w-full p-3 bg-gray-100 rounded"
                      rows={3}
                      value={editPost[item.post_id]?.body || ''}
                      onChange={e => setEditPost(prev => ({ ...prev, [item.post_id]: { ...(prev[item.post_id]||{}), body: e.target.value } }))}
                    />
                    <input
                      className="w-full p-2 bg-gray-100 rounded"
                      placeholder="Image URL (optional)"
                      value={editPost[item.post_id]?.image_url || ''}
                      onChange={e => setEditPost(prev => ({ ...prev, [item.post_id]: { ...(prev[item.post_id]||{}), image_url: e.target.value } }))}
                    />
                  </div>
                )}
              </div>
            ) : (
              <div data-keepopen>
                {item.feed_type === 'campaign' ? (
                  <>
                    <p className="whitespace-pre-line">{item.body}</p>
                    {/* Link to campaign detail: item.post_id is negative for campaigns */}
                    <div className="mt-3">
                      <a className="text-sm text-purple-700 hover:underline" href={`/campaigns/${Math.abs(item.post_id)}`}>Open campaign</a>
                    </div>
                  </>
                ) : editPost[item.post_id] === undefined ? (
                  <>
                    <p className="whitespace-pre-line">{item.body}</p>
                    {item.post_updated_at && (
                      <p className="mt-1 text-[11px] text-gray-500">edited · {new Date(item.post_updated_at).toLocaleString()}</p>
                    )}
                    {item.image_url && (
                      <img src={item.image_url} alt="post" className="mt-4 rounded-lg max-h-[420px] object-cover w-full" />
                    )}
                  </>
                ) : (
                  <div className="space-y-3" data-keepopen>
                    <textarea
                      className="w-full p-3 bg-gray-100 rounded"
                      rows={3}
                      value={editPost[item.post_id]?.body || ''}
                      onChange={e => setEditPost(prev => ({ ...prev, [item.post_id]: { ...(prev[item.post_id]||{}), body: e.target.value } }))}
                    />
                    <input
                      className="w-full p-2 bg-gray-100 rounded"
                      placeholder="Image URL (optional)"
                      value={editPost[item.post_id]?.image_url || ''}
                      onChange={e => setEditPost(prev => ({ ...prev, [item.post_id]: { ...(prev[item.post_id]||{}), image_url: e.target.value } }))}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex items-center justify-between text-sm">
              <div className="flex items-center space-x-6 text-gray-600">
        {item.feed_type !== 'campaign' && (
        <button
                  type="button"
                  className="flex items-center space-x-2 hover:text-purple-700"
                  onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const pid = item.post_id;
          const fk = item.share_id ? `share-${item.share_id}` : `post-${item.post_id}`;
          const isOpen = !!openComments[fk];
          const next = { [fk]: !isOpen };
                    setOpenComments(next);
                    if (!isOpen && !commentsMap[pid]) {
          // Lazy fetch comments only first time opened to reduce initial payload
                      const r = await api.comments(pid);
                      setCommentsMap(prev => ({ ...prev, [pid]: r.results || r || [] }));
                    }
                  }}
                  data-keepopen
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M18 10c0 3.866-3.582 7-8 7a8.91 8.91 0 01-3.777-.827L2 17l.827-4.223A7.003 7.003 0 012 10c0-3.866 3.582-7 8-7s8 3.134 8 7z"/></svg>
                  {!!item.comment_count && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-gray-200 text-gray-700 text-[11px] px-2 py-[2px]">
                      {item.comment_count}
                    </span>
                  )}
                </button>
        )}
                <span className="text-gray-300">|</span>
        {item.feed_type !== 'campaign' && (
  <button
                  type="button"
                  className="flex items-center space-x-2 hover:text-purple-700"
      onClick={async (e) => {
    e.preventDefault();
    e.stopPropagation();
          const fk = item.share_id ? `share-${item.share_id}` : `post-${item.post_id}`;
          setShareText(prev => (prev[fk] !== undefined ? {} : { [fk]: '' }));
                  }}
                  data-keepopen
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M15 8a3 3 0 10-2.83-4H9a1 1 0 000 2h3.17A3.001 3.001 0 0015 8zM5 12a3 3 0 102.83 4H11a1 1 0 100-2H7.83A3.001 3.001 0 005 12zm10 1a1 1 0 00-1 1v1.17l-7.39-3.2a1 1 0 10-.82 1.84l7.4 3.2A1 1 0 0015 16h.09A3 3 0 1015 13z"/></svg>
                </button>
        )}
              </div>
            </div>

            {/* Share composer */}
  {item.feed_type !== 'campaign' && shareText[item.share_id ? `share-${item.share_id}` : `post-${item.post_id}`] !== undefined && (
              <form
                className="mt-3 flex items-center space-x-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const pid = item.post_id;
                  const fk = item.share_id ? `share-${item.share_id}` : `post-${item.post_id}`;
                  const text = (shareText[fk] || '').trim();
                  setShareBusy(prev => ({ ...prev, [fk]: true }));
                  try {
                    await api.sharePost(pid, text || undefined);
                    // Close share composer after sharing
                    setShareText({});
                    // Refresh feed to include the new share at top
                    const r = await api.newsFeed();
                    setPosts(r.results);
                  } finally {
                    setShareBusy(prev => ({ ...prev, [fk]: false }));
                  }
                }}
    data-keepopen
              >
                <input
                  className="flex-1 p-3 bg-gray-100 rounded-lg"
                  placeholder="Add a note (optional)"
                  value={shareText[item.share_id ? `share-${item.share_id}` : `post-${item.post_id}`]}
                  onChange={e => {
                    const fk = item.share_id ? `share-${item.share_id}` : `post-${item.post_id}`;
                    setShareText(prev => ({ ...prev, [fk]: e.target.value }));
                  }}
                />
                <button className="py-2 px-4 bg-purple-600 text-white rounded-lg" disabled={!!shareBusy[item.share_id ? `share-${item.share_id}` : `post-${item.post_id}`]}>
                  {shareBusy[item.share_id ? `share-${item.share_id}` : `post-${item.post_id}`] ? 'Sharing...' : 'Share'}
                </button>
              </form>
            )}

            {/* Comments */}
  {openComments[item.share_id ? `share-${item.share_id}` : `post-${item.post_id}`] && (
              <div className="mt-4" data-keepopen>
                <div className="space-y-3">
                  {(commentsMap[item.post_id] || []).map(c => (
                    <div key={c.id} className="flex items-start space-x-3">
                      {c.author_avatar_url ? (
                        <img src={c.author_avatar_url} alt="avatar" className="w-9 h-9 rounded-full object-cover border" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600">
                          {(c.author_name || 'U').trim().slice(0,1).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-sm"><strong>{c.author_name || 'User'}</strong></p>
                          {String(c.user_id) === String(me?.id || '') && (
                            <div className="flex items-center space-x-2" data-keepopen>
                              {editComment[c.id] === undefined ? (
                                <>
                                  <button
                                    type="button"
                                    className="p-1 hover:bg-gray-100 rounded"
                                    title="Edit comment"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditComment(prev => ({ ...prev, [c.id]: c.body })); }}
                                    data-keepopen
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 010 2.828l-8.5 8.5a2 2 0 01-.878.513l-4 1a1 1 0 01-1.213-1.213l1-4a2 2 0 01.513-.878l8.5-8.5a2 2 0 012.828 0z"/><path d="M15 7l-2-2"/></svg>
                                  </button>
                  <button
                                    type="button"
                                    className="p-1 hover:bg-gray-100 rounded"
                                    title="Delete comment"
                                    onClick={async (e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      try {
                                        await api.deleteComment(c.id);
                                        const r = await api.comments(item.post_id);
                                        setCommentsMap(prev => ({ ...prev, [item.post_id]: r.results || r || [] }));
                                        // adjust comment count locally
                                        setPosts(prev => prev.map(x => x.post_id === item.post_id ? ({ ...x, comment_count: Math.max(0, (x.comment_count||0)-1) }) : x));
                                      } catch (e) {
                                        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e?.message || 'Failed to delete comment' } }));
                                      }
                                    }}
                                    data-keepopen
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-red-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-1 1v1H5.5a.5.5 0 000 1H6v10a2 2 0 002 2h4a2 2 0 002-2V5h.5a.5.5 0 000-1H12V3a1 1 0 00-1-1H9zm1 4a.75.75 0 011.5 0v8a.75.75 0 01-1.5 0V6zM8 6.75A.75.75 0 019.5 6v8a.75.75 0 01-1.5 0V6.75z" clipRule="evenodd"/></svg>
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="p-1 hover:bg-gray-100 rounded"
                                    title="Save comment"
                                    onClick={async (e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const body = (editComment[c.id] || '').trim();
                                      if (!body) return;
                                      setEditBusy(prev => ({ ...prev, [c.id]: true }));
                                      try {
                                        await api.updateComment(c.id, body);
                                        const r = await api.comments(item.post_id);
                                        setCommentsMap(prev => ({ ...prev, [item.post_id]: r.results || r || [] }));
                                        setEditComment(prev => {
                                          const next = { ...prev };
                                          delete next[c.id];
                                          return next;
                                        });
                                      } catch (e) {
                                        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e?.message || 'Failed to update comment' } }));
                                      } finally {
                                        setEditBusy(prev => ({ ...prev, [c.id]: false }));
                                      }
                                    }}
                                    disabled={!!editBusy[c.id]}
                                    data-keepopen
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-700" viewBox="0 0 20 20" fill="currentColor"><path d="M17.293 3.293a1 1 0 010 1.414l-8.147 8.147-3.439 1.146 1.146-3.439 8.147-8.147a1 1 0 011.414 0z"/><path d="M5 13l4 4"/></svg>
                                  </button>
                                  <button
                                    type="button"
                                    className="p-1 hover:bg-gray-100 rounded"
                                    title="Cancel"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditComment(prev => { const n = { ...prev }; delete n[c.id]; return n; }); }}
                                    data-keepopen
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-600" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/></svg>
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                        {editComment[c.id] === undefined ? (
                          <p className="text-sm whitespace-pre-line">{c.body}</p>
                        ) : (
                          <input
                            className="mt-2 w-full p-2 bg-gray-100 rounded"
                            value={editComment[c.id]}
                            onChange={e => setEditComment(prev => ({ ...prev, [c.id]: e.target.value }))}
                            data-keepopen
                          />
                        )}
                        <p className="text-[11px] text-gray-500">
                          {c.updated_at ? (
                            <>
                              <span>edited · {new Date(c.updated_at).toLocaleString()}</span>
                            </>
                          ) : (
                            new Date(c.created_at).toLocaleString()
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                  {item.feed_type === 'post' ? (
                    <form
                      className="mt-3 flex items-center space-x-3"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const fk = `post-${item.post_id}`;
                        const text = (newComment[fk] || '').trim();
                        if (!text) return;
                        await api.addComment(item.post_id, text);
                        setNewComment(prev => ({ ...prev, [fk]: '' }));
                        const r = await api.comments(item.post_id);
                        setCommentsMap(prev => ({ ...prev, [item.post_id]: r.results || r || [] }));
                        // bump comment count locally
                        setPosts(prev => prev.map(x => x.post_id === item.post_id ? ({ ...x, comment_count: (x.comment_count||0)+1 }) : x));
                      }}
                      data-keepopen
                    >
                      <input
                        className="flex-1 p-3 bg-gray-100 rounded-lg"
                        placeholder="Write a comment..."
                        value={newComment[`post-${item.post_id}`] || ''}
                        onChange={e => {
                          const fk = `post-${item.post_id}`;
                          setNewComment(prev => ({ ...prev, [fk]: e.target.value }));
                        }}
                      />
                      <button className="py-2 px-4 bg-gray-800 text-white rounded-lg">Comment</button>
                    </form>
                  ) : (
                    <p className="mt-3 text-xs text-gray-500">Add comments on the original post.</p>
                  )}
              </div>
            )}

      {/* Shares list removed */}
          </div>
        ))}
    {/* in-feed search results removed */}
      </div>

      <div className="main-right col-span-1 space-y-4">
        {isFireService ? (
          <>
            <div className="p-4 bg-white border border-gray-200 rounded-lg" data-keepopen>
              <div className="flex items-center justify-between mb-4" data-keepopen>
                <h3 className="text-xl" data-keepopen>Current Deployments</h3>
                <button
                  type="button"
                  className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
                  onClick={loadActivities}
                  disabled={activitiesLoading}
                  data-keepopen
                >{activitiesLoading ? '...' : 'Refresh'}</button>
              </div>
              {activitiesError && <div className="text-xs text-red-600 mb-2" data-keepopen>{activitiesError}</div>}
              {activitiesLoading && <div className="text-xs text-gray-500" data-keepopen>Loading…</div>}
              {!activitiesLoading && currentActivities.length === 0 && (
                <div className="text-xs text-gray-500" data-keepopen>No active deployments.</div>
              )}
              <ul className="space-y-3 max-h-72 overflow-auto pr-1" data-keepopen>
                {currentActivities.map(a => (
                  <li key={a.id} className="p-2 bg-gray-50 border border-gray-200 rounded text-[11px] space-y-1" data-keepopen>
                    <div className="flex items-start justify-between" data-keepopen>
                      <div className="flex-1 pr-2" data-keepopen>
                        <p className="font-semibold" data-keepopen>#{a.id} <span className="text-[10px] text-gray-500">{a.assigned_team_at ? new Date(a.assigned_team_at).toLocaleString() : ''}</span></p>
                        <p className="whitespace-pre-line" data-keepopen>{(a.description||'').slice(0,110)}{(a.description||'').length>110?'…':''}</p>
                        {a.team_name && <p className="text-[10px] text-gray-500" data-keepopen>Team: {a.team_name}</p>}
                      </div>
                      <div className="text-[10px] font-semibold text-indigo-700" data-keepopen>{a.status}</div>
                    </div>
                    <div className="flex items-center space-x-2" data-keepopen>
                      <button
                        type="button"
                        className="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-[11px]"
                        disabled={!!completeBusy[a.id]}
                        onClick={async () => {
                          setCompleteBusy(b => ({ ...b, [a.id]: true }));
                          try {
                            await api.completeFireRequest(a.id);
                            window.dispatchEvent(new CustomEvent('fire-request-completed', { detail: { request_id: a.id }}));
                            setCurrentActivities(prev => prev.filter(x => x.id !== a.id));
                            setPastActivities(prev => [{ ...a, status: 'completed', completed_at: new Date().toISOString() }, ...prev]);
                          } catch (e) {
                            setActivitiesError(e.message || 'Complete failed');
                          } finally {
                            setCompleteBusy(b => { const n={...b}; delete n[a.id]; return n; });
                          }
                        }}
                        data-keepopen
                      >{completeBusy[a.id] ? '...' : 'Completed'}</button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-4 bg-white border border-gray-200 rounded-lg" data-keepopen>
              <h3 className="mb-4 text-xl" data-keepopen>Past Deployments</h3>
              {activitiesLoading && <div className="text-xs text-gray-500" data-keepopen>Loading…</div>}
              {!activitiesLoading && pastActivities.length === 0 && (
                <div className="text-xs text-gray-500" data-keepopen>No past deployments.</div>
              )}
              <ul className="space-y-3 max-h-72 overflow-auto pr-1" data-keepopen>
                {pastActivities.map(a => (
                  <li key={a.id} className="p-2 bg-gray-50 border border-gray-200 rounded text-[11px] space-y-1" data-keepopen>
                    <div className="flex items-start justify-between" data-keepopen>
                      <div className="flex-1 pr-2" data-keepopen>
                        <p className="font-semibold" data-keepopen>#{a.id} <span className="text-[10px] text-gray-500">{a.completed_at ? new Date(a.completed_at).toLocaleString() : ''}</span></p>
                        <p className="whitespace-pre-line" data-keepopen>{(a.description||'').slice(0,110)}{(a.description||'').length>110?'…':''}</p>
                        {a.team_name && <p className="text-[10px] text-gray-500" data-keepopen>Team: {a.team_name}</p>}
                      </div>
                      <div className="text-[10px] font-semibold text-green-700" data-keepopen>{a.status}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <>
            {/* Active events nearby */}
            <ActiveEventsNearby />
          </>
        )}
      </div>
    </div>
  );
}

function ActiveEventsNearby() {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [locDenied, setLocDenied] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function load(lat, lng) {
      setLoading(true); setError('');
      try {
        const r = await api.crisesNearby(lat && lng ? { lat, lng, radius_km: 25 } : {});
        if (cancelled) return;
        const rows = Array.isArray(r?.results) ? r.results : [];
        setItems(rows.slice(0, 5));
      } catch (e) {
        if (cancelled) return;
        setError(e.message || 'Failed to load nearby events');
      } finally { if (!cancelled) setLoading(false); }
    }
    // Try browser geolocation first
    if (navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function') {
      navigator.geolocation.getCurrentPosition(
        pos => load(pos.coords.latitude, pos.coords.longitude),
        () => { setLocDenied(true); load(); },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
      );
    } else {
      // Fallback: server will use last known user location
      load();
    }
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg">
      <h3 className="mb-4 text-xl">Active events nearby</h3>
      {loading && <div className="text-xs text-gray-600">Finding events around you…</div>}
      {error && <div className="text-xs text-red-600">{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="text-xs text-gray-600">
          {locDenied ? 'Location access denied. ' : ''}
          No active events found within 25 km.
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <ul className="space-y-3 text-sm">
          {items.map(ev => (
            <li key={ev.crisis_id} className="flex items-start justify-between">
              <div>
                <div className="font-medium leading-tight">
                  {ev.title || `Crisis #${ev.crisis_id}`}
                </div>
                <div className="text-[11px] text-gray-500">
                  {(typeof ev.distance_km === 'number') ? `${ev.distance_km} km away` : ''}
                  {ev.severity ? ` · ${String(ev.severity).toUpperCase()}` : ''}
                </div>
              </div>
              <div>
                <a href={`/crises/${ev.crisis_id}`} className="py-1.5 px-2 bg-purple-600 text-white text-[11px] rounded">Open</a>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 text-[11px] text-gray-500">
        Tip: Share your location to improve accuracy.
      </div>
    </div>
  );
}
