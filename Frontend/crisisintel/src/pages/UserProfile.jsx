import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api';

export default function UserProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const isMe = me && String(me.id) === String(id);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activity, setActivity] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgError, setMsgError] = useState(null);
  const [msgOk, setMsgOk] = useState(null);
  const [followError, setFollowError] = useState(null);
  // Edit bio/avatar (only me)
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [avatarDraft, setAvatarDraft] = useState('');
  const [orgs, setOrgs] = useState([]);
  const [hospitalPageId, setHospitalPageId] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  // Post composer (only me)
  const [composerText, setComposerText] = useState('');
  const [composerImage, setComposerImage] = useState('');
  const [composerBusy, setComposerBusy] = useState(false);
  // Chat widget state
  const [showChat, setShowChat] = useState(false);
  const [chatText, setChatText] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [chatItems, setChatItems] = useState([]); // minimal in-panel memory
  // Comments state
  const [openCommentsPostId, setOpenCommentsPostId] = useState(null);
  const [commentsByPost, setCommentsByPost] = useState({}); // { [postId]: Comment[] }
  const [commentInputs, setCommentInputs] = useState({}); // { [postId]: string }
  const [commentsBusy, setCommentsBusy] = useState({}); // { [postId]: boolean }
  const redirectedRef = useRef(false);
  // Profile tabs (non-blood-bank): posts | campaigns | volunteers
  const [profileTab, setProfileTab] = useState('posts');
  // Campaigns owned by profile user
  const [userCampaigns, setUserCampaigns] = useState([]);
  const [campLoading, setCampLoading] = useState(false);
  const [campError, setCampError] = useState(null);
  // Volunteers of the profile user's social organization
  const [profileOrg, setProfileOrg] = useState(null);
  const [orgVols, setOrgVols] = useState([]);
  const [orgVolsLoading, setOrgVolsLoading] = useState(false);
  const [orgVolsError, setOrgVolsError] = useState(null);
  // Blood bank profile UX
  const [bbActiveTab, setBbActiveTab] = useState('posts'); // posts|donors|recruit
  const [bbDonors, setBbDonors] = useState([]);
  const [bbDonorsLoading, setBbDonorsLoading] = useState(false);
  const [bbDonorsFilter, setBbDonorsFilter] = useState('');
  const [bbRecruitPosts, setBbRecruitPosts] = useState([]);
  const [bbRecruitLoading, setBbRecruitLoading] = useState(false);
  // Request modals
  const [openBankReq, setOpenBankReq] = useState(false);
  const [bankReqDraft, setBankReqDraft] = useState({ blood_type:'', quantity_units:1, target_datetime:'', location_text:'' });
  const [openDonorReq, setOpenDonorReq] = useState(false);
  const [donorReqDraft, setDonorReqDraft] = useState({ donor_user_id:null, blood_type:'', target_datetime:'', location_text:'' });
  // Recruitment apply modal
  const [openApply, setOpenApply] = useState(false);
  const [applyDraft, setApplyDraft] = useState({ post_id: null, blood_type: '', notes: '' });

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [u, a, o] = await Promise.all([
        api.getUserPublic(id),
        api.getUserActivity(id),
        api.getUserOrganizations(id)
      ]);
      setData(u);
      const items = Array.isArray(a?.items) ? a.items : [];
      setActivity(items);
      setOrgs(Array.isArray(o?.items) ? o.items : []);
      // Resolve hospital page id if applicable
      let hospId = null;
      const orgHosp = (Array.isArray(o?.items) ? o.items : []).find(it => it.type === 'hospital');
      if (orgHosp && orgHosp.id != null) hospId = orgHosp.id;
      if (!hospId && u?.role === 'hospital') {
        try {
          const h = await api.getHospitalByUser(u.id);
          if (h?.id) hospId = h.id;
        } catch {}
      }
      setHospitalPageId(hospId);
      // Unify pages for org roles: redirect to their canonical org page
      if (!redirectedRef.current) {
        if (u?.role === 'fire_service') {
          const fd = (Array.isArray(o?.items) ? o.items : []).find(it => it.type === 'fire_department');
          if (fd && fd.id != null) {
            redirectedRef.current = true;
            navigate(`/fire-departments/${fd.id}`, { replace: true });
            return; // stop further processing on this page
          }
        }
        if (u?.role === 'hospital' && hospId) {
          redirectedRef.current = true;
          navigate(`/hospitals/${hospId}`, { replace: true });
          return;
        }
      }
      if (isMe) {
        setBioDraft(u?.bio || '');
        setAvatarDraft(u?.avatar_url || '');
      }
    } catch (e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [id]);

  // When Campaigns tab is opened, load campaigns owned by the profile user
  useEffect(() => {
    const run = async () => {
      if (profileTab !== 'campaigns' || !data?.id) return;
      setCampError(null); setCampLoading(true);
      try {
        const r = await api.request('/campaigns/list');
        const all = Array.isArray(r?.results) ? r.results : [];
        setUserCampaigns(all.filter(c => String(c.owner_user_id) === String(data.id)));
      } catch (e) {
        setCampError(e.message || 'Failed to load campaigns');
      } finally { setCampLoading(false); }
    };
    run();
  }, [profileTab, data?.id]);

  // Resolve profile user's social organization when Volunteers tab opens, then load volunteers
  useEffect(() => {
    let cancelled = false;
    const resolveOrgAndLoad = async () => {
      if (profileTab !== 'volunteers' || !data?.id) return;
      setOrgVolsError(null); setOrgVolsLoading(true);
      try {
        // Try from already-fetched orgs first
        let org = (orgs || []).find(o => String(o.type||'').toLowerCase().includes('org')) || null;
        if (!org) {
          // Fallback: list organizations and pick owned by profile user
          const all = await api.request('/social/organizations/list');
          const list = all.results || [];
          org = list.find(o => String(o.user_id) === String(data.id)) || null;
        }
        if (!org) {
          setProfileOrg(null);
          setOrgVols([]);
          setOrgVolsError('No organization found for this user.');
          return;
        }
        if (cancelled) return;
        setProfileOrg(org);
        try {
          const vr = await api.socialOrgListVolunteers(org.id);
          const arr = Array.isArray(vr?.results) ? vr.results : [];
          setOrgVols(arr.filter(v => v.status === 'accepted'));
        } catch (e) {
          setOrgVolsError(e.message || "Couldn't load volunteers (owner-only?)");
        }
      } catch (e) {
        setOrgVolsError(e.message || 'Failed to locate organization');
      } finally { if (!cancelled) setOrgVolsLoading(false); }
    };
    resolveOrgAndLoad();
    return () => { cancelled = true; };
  }, [profileTab, data?.id, orgs]);

  // Lazy-load donors when opening donors tab
  useEffect(() => {
    const fn = async () => {
      if (bbActiveTab !== 'donors') return;
      if (!data) return;
      const isBank = String(data.role||'').toLowerCase().includes('blood');
      if (!isBank) return;
      setBbDonorsLoading(true);
      try {
        const res = await api.bloodBankDonorsOf(data.id);
        setBbDonors(Array.isArray(res?.results) ? res.results : []);
      } catch (e) {
        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to load donors' } }));
      } finally { setBbDonorsLoading(false); }
    };
    fn();
  }, [bbActiveTab, data]);

  // Lazy-load recruitment posts when opening recruitment tab
  useEffect(() => {
    const fn = async () => {
      if (bbActiveTab !== 'recruit') return;
      if (!data) return;
      const isBank = String(data.role||'').toLowerCase().includes('blood');
      if (!isBank) return;
      setBbRecruitLoading(true);
      try {
        // First try active-only posts
        let res = await api.listRecruitPosts({ owner_user_id: data.id, status: 'active' });
        let items = Array.isArray(res?.results) ? res.results : [];
        // Fallback: if none found (older rows may have NULL/other statuses), fetch all and let UI show status chips
        if (!items || items.length === 0) {
          try {
            res = await api.listRecruitPosts({ owner_user_id: data.id });
            items = Array.isArray(res?.results) ? res.results : [];
          } catch {}
        }
        setBbRecruitPosts(items);
      } catch (e) {
        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to load recruitment posts' } }));
      } finally { setBbRecruitLoading(false); }
    };
    fn();
  }, [bbActiveTab, data]);

  const toggleFollow = async () => {
    if (!data) return;
    setBusy(true);
    setFollowError(null);
    try {
      if (data.is_following) {
        await api.unfollowUser(id);
      } else {
        await api.followUser(id);
      }
      await refresh();
    } catch (e) {
      setFollowError(e.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async () => {
    const body = chatText.trim();
    if (!body) return;
    setMsgBusy(true); setMsgError(null); setMsgOk(null);
    try {
      const res = await api.sendDirectMessage(Number(id), body);
      if (res?.conversation_id) setConversationId(res.conversation_id);
      // append to local chat history (so it persists while panel open)
      const newMsg = { id: res?.message_id || Date.now(), sender_user_id: me?.id, body, created_at: new Date().toISOString() };
      setChatItems(prev => ([...prev, newMsg]));
      try {
        const cacheKey = `chat:${id}`;
        const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
        const convId = res?.conversation_id || cached?.conversationId || conversationId || null;
        const items = (cached?.items || []).concat([newMsg]);
        sessionStorage.setItem(cacheKey, JSON.stringify({ conversationId: convId, items }));
      } catch {}
      setMsgOk('Sent');
      setChatText('');
      setTimeout(()=> setMsgOk(null), 2000);
    } catch (e) {
      setMsgError(e.message || 'Failed to send');
      setTimeout(()=> setMsgError(null), 3000);
    } finally {
      setMsgBusy(false);
    }
  };

  const openChat = async () => {
    const opening = !showChat;
    setShowChat(opening);
    if (opening) {
      const cacheKey = `chat:${id}`;
      // Load from session cache if present
      try {
        const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
        if (cached && Array.isArray(cached.items)) {
          setChatItems(cached.items);
          if (cached.conversationId) setConversationId(cached.conversationId);
        }
      } catch {}
      // Try to locate an existing conversation and load history
      try {
        const convs = await api.listConversations();
        const items = Array.isArray(convs?.items) ? convs.items : [];
        const existing = items.find(it => String(it.partner_user_id) === String(id));
        if (existing) {
          setConversationId(existing.id);
          const hist = await api.conversationHistory(existing.id);
          const msgs = Array.isArray(hist?.items) ? hist.items : [];
          setChatItems(msgs);
          sessionStorage.setItem(cacheKey, JSON.stringify({ conversationId: existing.id, items: msgs }));
        }
      } catch (e) {
        console.warn('chat open: history load failed or none');
      }
    }
  };

  const toggleComments = async (postId) => {
    if (openCommentsPostId === postId) {
      setOpenCommentsPostId(null);
      return;
    }
    setOpenCommentsPostId(postId);
    if (!commentsByPost[postId]) {
      setCommentsBusy(prev => ({ ...prev, [postId]: true }));
      try {
        const res = await api.comments(postId);
        const items = Array.isArray(res?.results) ? res.results : [];
        setCommentsByPost(prev => ({ ...prev, [postId]: items }));
      } catch (e) {
        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to load comments' }}));
      } finally {
        setCommentsBusy(prev => ({ ...prev, [postId]: false }));
      }
    }
  };

  const submitComment = async (postId) => {
    const text = (commentInputs[postId] || '').trim();
    if (!text) return;
    setCommentsBusy(prev => ({ ...prev, [postId]: true }));
    try {
      const res = await api.addComment(postId, text);
      const newItem = { id: res.id, body: text, author_name: (me?.full_name || 'You'), created_at: new Date().toISOString() };
      setCommentsByPost(prev => ({ ...prev, [postId]: [ ...(prev[postId] || []), newItem ] }));
      setCommentInputs(prev => ({ ...prev, [postId]: '' }));
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to comment' }}));
    } finally {
      setCommentsBusy(prev => ({ ...prev, [postId]: false }));
    }
  };

  // Build organization map and group activities under organizations (hooks must be before any return)
  const orgMap = React.useMemo(() => {
    const m = {};
    (orgs || []).forEach(o => { m[`${o.type}:${o.id}`] = o; });
    return m;
  }, [orgs]);
  const groupedActivity = React.useMemo(() => {
    const groups = {};
    (activity || []).forEach(it => {
      const hasOrg = it.org_type && it.org_id != null;
      const key = hasOrg ? `${it.org_type}:${it.org_id}` : 'personal';
      if (!groups[key]) groups[key] = [];
      groups[key].push(it);
    });
    // Order: org groups first (alphabetical by name), then personal
    const entries = Object.entries(groups);
    const orgEntries = entries.filter(([k]) => k !== 'personal').sort((a,b) => {
      const oa = orgMap[a[0]]; const ob = orgMap[b[0]];
      const na = (oa?.name || a[0]).toLowerCase();
      const nb = (ob?.name || b[0]).toLowerCase();
      return na.localeCompare(nb);
    });
    const personal = entries.find(([k]) => k === 'personal');
    return { orgEntries, personal };
  }, [activity, orgMap]);

  if (loading) return <div className="p-4 bg-white border rounded">Loading...</div>;
  if (error) return <div className="p-4 bg-white border rounded text-red-600">{error}</div>;
  if (!data) return null;

  const initial = (data.full_name || data.email || 'U')[0].toUpperCase();
  const roleStr = String(data.role||'').toLowerCase();
  const isBloodBankProfile = roleStr.includes('blood');
  // Show social org features (campaigns/volunteers) only for NGO/Social users or when the user belongs to an org
  const isSocialRole = roleStr.includes('ngo') || roleStr.includes('social');
  const isOrgMember = (orgs || []).some(o => String(o.type||'').toLowerCase().includes('org'));
  const showCampaignsTab = isSocialRole || isOrgMember; // hide for plain regular users
  const showVolunteersTab = isSocialRole && isMe; // owners will navigate to manage view; hide for viewers/regulars

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {data.avatar_url ? (
            <img src={data.avatar_url} alt="avatar" className="w-16 h-16 rounded-full border object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-purple-600 text-white flex items-center justify-center text-2xl font-bold">{initial}</div>
          )}
          <div>
            <div className="text-xl font-semibold flex items-center flex-wrap gap-2">
              <span>{data.full_name || data.email}</span>
              {data.role && (
                <span className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-700 capitalize">{String(data.role).replace('_',' ')}</span>
              )}
            </div>
            <div className="text-sm text-gray-500">{data.email}</div>
            {/* role removed per request */}
            <div className="text-xs text-gray-500 mt-1">{data.followers || 0} followers · {data.following || 0} following · {data.post_count || 0} posts</div>
            {isMe ? (
              <div className="mt-2">
                {!editingBio ? (
                  <div className="text-sm text-gray-700 whitespace-pre-wrap">
                    {data.bio ? data.bio : <span className="text-gray-400">No bio yet. Click edit to add one.</span>}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <textarea className="w-full border rounded px-3 py-2 text-sm" rows={3} value={bioDraft} onChange={e=>setBioDraft(e.target.value)} placeholder="Write your bio..." />
                    <div className="flex items-center space-x-2">
                      <input className="flex-1 border rounded px-3 py-2 text-sm" placeholder="Avatar image URL (optional)" value={avatarDraft} onChange={e=>setAvatarDraft(e.target.value)} />
                      <label className="px-3 py-2 text-sm bg-gray-100 rounded cursor-pointer">
                        Upload
                        <input type="file" accept="image/*" className="hidden" onChange={async (e)=>{
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setUploadBusy(true);
                          try {
                            const { url } = await api.uploadImage(file);
                            setAvatarDraft(url);
                          } catch (err) {
                            window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Upload failed' } }));
                          } finally { setUploadBusy(false); }
                        }} />
                      </label>
                      <button className="px-3 py-2 text-sm bg-gray-200 rounded" onClick={()=>{ setEditingBio(false); setBioDraft(data.bio || ''); setAvatarDraft(data.avatar_url || ''); }}>Cancel</button>
                      <button className="px-3 py-2 text-sm bg-purple-600 text-white rounded" onClick={async ()=>{
                        try {
                          const patch = { bio: bioDraft };
                          if (avatarDraft !== (data.avatar_url || '')) patch.avatar_url = avatarDraft;
                          const res = await api.updateCurrentUser(patch);
                          const next = res || { ...data, bio: bioDraft, avatar_url: avatarDraft };
                          setData(next);
                          if (isMe) {
                            try { localStorage.setItem('me', JSON.stringify({ ...(JSON.parse(localStorage.getItem('me')||'{}')), full_name: next.full_name, email: next.email, role: next.role, id: next.id, avatar_url: next.avatar_url })); } catch {}
                          }
                          setEditingBio(false);
                        } catch (e) {
                          window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to update profile' } }));
                        }
                      }}>Save</button>
                    </div>
                    {uploadBusy && <div className="text-xs text-gray-500">Uploading...</div>}
                  </div>
                )}
              </div>
            ) : (
              data.bio ? <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{data.bio}</div> : null
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
        {isMe ? (
          <>
            {!editingBio && (
              <button className="py-2 px-4 rounded bg-gray-100" onClick={()=> setEditingBio(true)}>Edit Profile</button>
            )}
          </>
        ) : (
          <div className="flex items-center space-x-2">
            <button
              className={`py-2 px-4 rounded ${data.is_following ? 'bg-gray-200' : 'bg-purple-600 text-white'}`}
              onClick={toggleFollow}
              disabled={busy}
            >{busy ? '...' : (data.is_following ? 'Unfollow' : 'Follow')}</button>
            <button
              className="py-2 px-4 rounded bg-gray-800 text-white"
              onClick={openChat}
              disabled={msgBusy}
            >Message</button>
            {isBloodBankProfile && (
              <button
                className="py-2 px-4 rounded bg-red-600 text-white"
                onClick={() => setOpenBankReq(true)}
              >Request Blood</button>
            )}
            {String(data.role||'').toLowerCase().includes('hospital') && hospitalPageId && (
              <>
                <Link className="py-2 px-4 rounded bg-gray-100" to={`/hospitals/${hospitalPageId}/services`}>Services</Link>
                <Link className="py-2 px-4 rounded bg-gray-100" to={`/hospitals/${hospitalPageId}/doctors/manage`}>Doctors</Link>
                <Link className="py-2 px-4 rounded bg-red-600 text-white" to={`/hospitals/${hospitalPageId}?ambulance=1`}>Request Ambulance</Link>
              </>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Blood bank tabs */}
      {isBloodBankProfile && (
        <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 flex items-center gap-2">
          {['posts','donors','recruit'].map(tab => (
            <button key={tab} className={`px-3 py-1 rounded text-sm ${bbActiveTab===tab ? 'bg-gray-900 text-white' : 'bg-gray-100'}`} onClick={()=>setBbActiveTab(tab)}>
              {tab === 'posts' ? 'Posts' : tab === 'donors' ? 'Donors' : 'Recruitment'}
            </button>
          ))}
        </div>
      )}

      {followError && <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700">{followError}</div>}
      {msgError && <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700">{msgError}</div>}
      {msgOk && <div className="p-3 bg-green-50 border border-green-200 rounded text-green-700">{msgOk}</div>}

      {/* Body with right sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg">
        {isMe && (!isBloodBankProfile || bbActiveTab==='posts') && (
          <div className="p-4 border-b border-gray-100">
            <div className="text-sm font-semibold mb-2">Create a post</div>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm"
              rows={3}
              placeholder="What's on your mind?"
              value={composerText}
              onChange={e=>setComposerText(e.target.value)}
            />
            <div className="mt-2 flex items-center gap-2">
              <input
                className="flex-1 border rounded px-3 py-2 text-sm"
                placeholder="Image URL (optional)"
                value={composerImage}
                onChange={e=>setComposerImage(e.target.value)}
              />
              <label className="px-3 py-2 text-sm bg-gray-100 rounded cursor-pointer">
                Upload
                <input type="file" accept="image/*" className="hidden" onChange={async (e)=>{
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setComposerBusy(true);
                  try { const { url } = await api.uploadImage(file); setComposerImage(url); }
                  catch(err){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Upload failed' } })); }
                  finally { setComposerBusy(false); }
                }} />
              </label>
              <button
                className="px-3 py-2 text-sm bg-purple-600 text-white rounded"
                disabled={composerBusy || (!composerText.trim() && !composerImage)}
                onClick={async ()=>{
                  const body = composerText.trim();
                  if (!body && !composerImage) return;
                  setComposerBusy(true);
                  try {
                    await api.createPost(body, composerImage || undefined);
                    setComposerText(''); setComposerImage('');
                    await refresh();
                  } catch(e){
                    window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to post' } }));
                  } finally { setComposerBusy(false); }
                }}
              >{composerBusy ? 'Posting...' : 'Post'}</button>
            </div>
          </div>
        )}
        {/* Non-blood-bank tab switcher */}
        {!isBloodBankProfile && (
          <div className="px-3 pt-3 border-b border-gray-100 flex items-center gap-2">
            {[ 'posts', ...(showCampaignsTab ? ['campaigns'] : []), ...(showVolunteersTab ? ['volunteers'] : []) ].map(tab => (
              <button
                key={tab}
                className={`px-3 py-1.5 rounded text-sm ${profileTab===tab ? 'bg-purple-600 text-white' : 'bg-gray-100'}`}
                onClick={() => setProfileTab(tab)}
              >{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
            ))}
          </div>
        )}

        {/* Left pane content by tab (non-blood-bank) */}
        {!isBloodBankProfile && profileTab==='posts' && (
          <>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div className="text-lg font-semibold">Posts & Shares</div>
              <div className="text-xs text-gray-500">{(groupedActivity.personal ? groupedActivity.personal[1].length : 0)} items</div>
            </div>
            {(!groupedActivity.personal || groupedActivity.personal[1].length===0) && (
              <div className="px-4 pb-4 text-sm text-gray-500">No posts or shares yet.</div>
            )}
            {groupedActivity.personal && (
              <div className="p-4">
                <div className="mb-3 text-sm font-semibold">Posts & Shares</div>
                <div className="space-y-3">
                  {groupedActivity.personal[1].map(item => (
                    <div key={`${item.type}-${item.id}`} className="p-4 bg-white border border-gray-200 rounded-lg">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          {data.avatar_url ? (
                            <img src={data.avatar_url} alt="avatar" className="w-9 h-9 rounded-full object-cover border" />
                          ) : (
                            <div className="w-9 h-9 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-bold">{initial}</div>
                          )}
                          <div className="text-sm">
                            <p className="font-semibold">{data.full_name || data.email}</p>
                            <p className="text-[11px] text-gray-500">{item.type === 'post' ? 'posted' : 'shared a post'}</p>
                          </div>
                        </div>
                        <div className="text-gray-600 text-xs">{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</div>
                      </div>
                      {item.type === 'post' ? (
                        <div>
                          <p className="whitespace-pre-line">{item.body}</p>
                          {item.image_url && <img src={item.image_url} alt="post" className="mt-4 rounded-lg max-h-[420px] object-cover w-full" />}
                          <div className="mt-2 flex items-center space-x-3 text-sm">
                            <Link to={`/posts/${item.id}`} className="text-purple-700 hover:underline">Open</Link>
                            {isMe && <>
                              <button className="text-gray-700 hover:underline" onClick={async ()=>{
                                const body = prompt('Edit post text', item.body || '');
                                if (body === null) return;
                                try { await api.updatePost(item.id, body, item.image_url || undefined); window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Post updated' } })); await refresh(); } catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to update' } })); }
                              }}>Edit</button>
                              <span className="text-gray-300">•</span>
                              <button className="text-red-700 hover:underline" onClick={async ()=>{
                                if (!window.confirm('Delete this post?')) return;
                                try { await api.deletePost(item.id); window.dispatchEvent(new CustomEvent('toast', { detail: { message: 'Post deleted' } })); await refresh(); } catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to delete' } })); }
                              }}>Delete</button>
                            </>}
                          </div>
                          <div className="mt-3">
                            <button className="text-sm text-gray-700 hover:underline" onClick={() => toggleComments(item.id)}>
                              {openCommentsPostId === item.id ? 'Hide comments' : 'Show comments'}
                            </button>
                          </div>
                          {openCommentsPostId === item.id && (
                            <div className="mt-3 border-t pt-3">
                              {commentsBusy[item.id] && (!commentsByPost[item.id] || commentsByPost[item.id].length === 0) && (
                                <div className="text-sm text-gray-500">Loading comments...</div>
                              )}
                              <div className="space-y-2">
                                {(commentsByPost[item.id] || []).map(c => (
                                  <div key={c.id} className="text-sm">
                                    <span className="font-medium">{c.author_name || 'User'}: </span>
                                    <span className="whitespace-pre-wrap">{c.body}</span>
                                    {c.created_at && <span className="ml-2 text-xs text-gray-400">{new Date(c.created_at).toLocaleString()}</span>}
                                  </div>
                                ))}
                              </div>
                              <div className="mt-3 flex items-center space-x-2">
                                <input
                                  type="text"
                                  className="flex-1 border rounded px-3 py-2 text-sm"
                                  placeholder="Write a comment..."
                                  value={commentInputs[item.id] || ''}
                                  onChange={e => setCommentInputs(prev => ({ ...prev, [item.id]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(item.id); } }}
                                />
                                <button
                                  className="px-3 py-2 rounded bg-purple-600 text-white text-sm"
                                  disabled={commentsBusy[item.id]}
                                  onClick={() => submitComment(item.id)}
                                >{commentsBusy[item.id] ? '...' : 'Comment'}</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div>
                          {item.comment && <p className="text-sm whitespace-pre-line">{item.comment}</p>}
                          <div className="mt-2 text-sm">
                            {item.post_id && <Link to={`/posts/${item.post_id}`} className="text-purple-700 hover:underline">Open post</Link>}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Campaigns tab */}
        {!isBloodBankProfile && showCampaignsTab && profileTab==='campaigns' && (
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Campaigns</div>
              <div className="text-xs text-gray-500">{userCampaigns.length} items</div>
            </div>
            {campLoading && <div className="text-sm text-gray-500">Loading campaigns...</div>}
            {campError && <div className="text-sm text-red-600">{campError}</div>}
            {!campLoading && !campError && userCampaigns.length === 0 && (
              <div className="text-sm text-gray-500">No campaigns yet.</div>
            )}
            {!campLoading && userCampaigns.length > 0 && (
              <div className="space-y-5">
                {/* Ongoing */}
                <div>
                  <div className="mb-2 text-sm font-semibold">Ongoing</div>
                  <div className="space-y-2">
                    {userCampaigns.filter(c => c.status === 'active').map(c => (
                      <div key={c.id} className="p-3 border rounded flex items-center justify-between">
                        <div>
                          <div className="font-semibold">{c.title}</div>
                          <div className="text-xs text-gray-500">#{c.id} · {c.location_text || '—'} · {c.starts_at || ''}{c.ends_at ? ` → ${c.ends_at}` : ''}</div>
                        </div>
                        <Link className="px-3 py-1.5 rounded bg-purple-600 text-white text-sm" to={`/campaigns/${c.id}`}>Open</Link>
                      </div>
                    ))}
                    {userCampaigns.filter(c => c.status === 'active').length === 0 && (
                      <div className="text-sm text-gray-500">None</div>
                    )}
                  </div>
                </div>
                {/* Past */}
                <div>
                  <div className="mb-2 text-sm font-semibold">Past</div>
                  <div className="space-y-2">
                    {userCampaigns.filter(c => c.status !== 'active').map(c => (
                      <div key={c.id} className="p-3 border rounded flex items-center justify-between">
                        <div>
                          <div className="font-semibold">{c.title}</div>
                          <div className="text-xs text-gray-500">#{c.id} · Status: {c.status} · {c.location_text || '—'}</div>
                        </div>
                        <Link className="px-3 py-1.5 rounded bg-gray-100 text-sm" to={`/campaigns/${c.id}`}>Open</Link>
                      </div>
                    ))}
                    {userCampaigns.filter(c => c.status !== 'active').length === 0 && (
                      <div className="text-sm text-gray-500">No past campaigns.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Volunteers tab */}
        {!isBloodBankProfile && showVolunteersTab && profileTab==='volunteers' && (
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Volunteers</div>
              <div className="text-xs text-gray-500">{orgVols.length} items</div>
            </div>
            {orgVolsLoading && <div className="text-sm text-gray-500">Loading volunteers...</div>}
            {orgVolsError && <div className="text-sm text-red-600">{orgVolsError}</div>}
            {!orgVolsLoading && !orgVolsError && orgVols.length === 0 && (
              <div className="text-sm text-gray-500">No volunteers yet.</div>
            )}
            {!orgVolsLoading && orgVols.length > 0 && (
              <ul className="space-y-2">
                {orgVols.map(v => (
                  <li key={v.id} className="p-3 border rounded flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-sm font-semibold">
                        {(v.user_full_name || v.user_email || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold flex items-center gap-2">
                          {v.user_full_name || v.user_email || `User #${v.user_id}`}
                          {v.role_label && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100">{v.role_label}</span>}
                        </div>
                        <div className="text-xs text-gray-500">Status: {v.status}</div>
                      </div>
                    </div>
                    {/* Only owners can manage; viewer gets read-only list */}
                    {isMe && profileOrg?.id && (
                      <Link className="px-3 py-1.5 rounded bg-gray-100 text-sm" to={`/social-org/volunteers`}>Manage</Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isBloodBankProfile && bbActiveTab==='donors' && (
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-semibold">Donors</div>
              <select className="border rounded px-2 py-1 text-sm" value={bbDonorsFilter} onChange={e=>setBbDonorsFilter(e.target.value)}>
                <option value="">All blood types</option>
                {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bt => <option key={bt} value={bt}>{bt}</option>)}
              </select>
            </div>
            {bbDonorsLoading && <div className="text-sm text-gray-500">Loading donors...</div>}
            {!bbDonorsLoading && bbDonors.filter(d => !bbDonorsFilter || d.blood_type === bbDonorsFilter).length === 0 && (
              <div className="text-sm text-gray-500">No donors yet.</div>
            )}
            <ul className="space-y-3">
              {bbDonors.filter(d => !bbDonorsFilter || d.blood_type === bbDonorsFilter).map(d => (
                <li key={d.id} className="p-3 border rounded flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {d.user_avatar_url ? (
                      <img src={d.user_avatar_url} alt="avatar" className="w-9 h-9 rounded-full object-cover border" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-purple-600 text-white flex items-center justify-center text-sm font-bold">{(d.user_full_name || 'U')[0]}</div>
                    )}
                    <div>
                      <div className="font-medium text-sm">{d.user_full_name || `User #${d.user_id}`}</div>
                      <div className="text-xs text-gray-600">Blood Type: <span className="font-medium">{d.blood_type}</span></div>
                    </div>
                  </div>
                  <button className="px-3 py-1.5 rounded bg-red-600 text-white text-sm" onClick={()=>{
                    setDonorReqDraft({ donor_user_id: d.user_id, blood_type: d.blood_type || '', target_datetime:'', location_text:'' });
                    setOpenDonorReq(true);
                  }}>Request</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isBloodBankProfile && bbActiveTab==='recruit' && (
          <div className="p-4">
            <div className="mb-3 text-lg font-semibold">Recruitment Posts</div>
            {bbRecruitLoading && <div className="text-sm text-gray-500">Loading posts...</div>}
            {!bbRecruitLoading && bbRecruitPosts.length===0 && <div className="text-sm text-gray-500">No recruitment posts yet.</div>}
            <div className="space-y-3">
              {bbRecruitPosts.map(p => (
                <div key={p.id} className="p-3 border rounded">
                  <div className="font-medium">Post #{p.id}</div>
                  <div className="text-sm text-gray-700">Target: {p.target_blood_type || 'Any'} • Deadline: {p.scheduled_at || 'TBD'} • Where: {p.location_text || '—'}</div>
                  {p.notes && <div className="mt-1 text-sm">{p.notes}</div>}
                  <div className="text-xs mt-1">
                    {(() => {
                      const raw = (p && p.status != null) ? String(p.status) : 'active';
                      const s = raw.toLowerCase().trim();
                      const isOpen = (s === '' || s === 'active' || s === 'open' || s == null);
                      return (
                        <span className={`px-2 py-0.5 rounded ${isOpen ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                          {isOpen ? 'Open' : 'Closed'}
                        </span>
                      );
                    })()}
                  </div>
                  {/* Apply button for non-owner viewers */}
                  {!isMe && me && (
                    <div className="mt-2">
                      <button
                        className="px-3 py-1.5 rounded bg-purple-600 text-white text-sm"
                        onClick={async () => {
                          // Prefill from donor profile if present
                          try {
                            const prof = await api.myDonorProfile();
                            const bt = (prof?.profile?.blood_type) || '';
                            setApplyDraft({ post_id: p.id, blood_type: bt, notes: '' });
                          } catch { setApplyDraft({ post_id: p.id, blood_type: '', notes: '' }); }
                          setOpenApply(true);
                        }}
                      >Apply</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="p-4 border-b border-gray-100 text-lg font-semibold">Organizations</div>
          <div className="p-4 space-y-4">
            {/* Show only true affiliations from API, not organizations inferred from activity (like appointments). */}
            {(() => {
              const allKeys = (orgs || []).map(o => `${o.type}:${o.id}`);
              if (allKeys.length === 0) return <div className="text-sm text-gray-500">No organizations to show.</div>;
              // Restrict grouped entries to only those orgs the user actually belongs to
              const filteredGrouped = groupedActivity.orgEntries.filter(([k]) => allKeys.includes(k));
              return (
                <OrgAccordion
                  allKeys={allKeys}
                  orgMap={orgMap}
                  groupedEntries={filteredGrouped}
                  profileUser={data}
                  initial={initial}
                  navigate={navigate}
                />
              );
            })()}
          </div>
        </div>
      </div>

      {/* Bank Inventory Request Modal */}
      {openBankReq && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-lg shadow">
            <div className="text-lg font-semibold mb-3">Request Blood from Bank</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select className="border rounded px-3 py-2" value={bankReqDraft.blood_type} onChange={e=>setBankReqDraft(v=>({...v, blood_type:e.target.value}))}>
                <option value="">Select blood type</option>
                {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bt => <option key={bt} value={bt}>{bt}</option>)}
              </select>
              <input type="number" min={1} className="border rounded px-3 py-2" placeholder="Quantity (bags)" value={bankReqDraft.quantity_units} onChange={e=>setBankReqDraft(v=>({...v, quantity_units: Math.max(1, Number(e.target.value)||1)}))} />
              <input type="datetime-local" className="border rounded px-3 py-2" value={bankReqDraft.target_datetime} onChange={e=>setBankReqDraft(v=>({...v, target_datetime:e.target.value}))} />
              <input className="border rounded px-3 py-2" placeholder="Location" value={bankReqDraft.location_text} onChange={e=>setBankReqDraft(v=>({...v, location_text:e.target.value}))} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-2 bg-gray-100 rounded" onClick={()=>setOpenBankReq(false)}>Cancel</button>
              <button className="px-3 py-2 bg-red-600 text-white rounded" onClick={async ()=>{
                try {
                  if (!bankReqDraft.blood_type) throw new Error('Select blood type');
                  await api.createInventoryRequest({ bank_user_id: data.id, ...bankReqDraft });
                  setOpenBankReq(false);
                  setBankReqDraft({ blood_type:'', quantity_units:1, target_datetime:'', location_text:'' });
                  window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Request submitted to bank' } }));
                } catch(e) {
                  window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Submit failed' } }));
                }
              }}>Submit</button>
            </div>
          </div>
        </div>
      )}

      {/* Donor Meeting Request Modal */}
      {openDonorReq && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-lg shadow">
            <div className="text-lg font-semibold mb-3">Request from Donor</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input type="datetime-local" className="border rounded px-3 py-2" value={donorReqDraft.target_datetime} onChange={e=>setDonorReqDraft(v=>({...v, target_datetime:e.target.value}))} />
              <input className="border rounded px-3 py-2" placeholder="Location" value={donorReqDraft.location_text} onChange={e=>setDonorReqDraft(v=>({...v, location_text:e.target.value}))} />
              <select className="border rounded px-3 py-2" value={donorReqDraft.blood_type} onChange={e=>setDonorReqDraft(v=>({...v, blood_type:e.target.value}))}>
                <option value="">Blood type (optional)</option>
                {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bt => <option key={bt} value={bt}>{bt}</option>)}
              </select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-2 bg-gray-100 rounded" onClick={()=>setOpenDonorReq(false)}>Cancel</button>
              <button className="px-3 py-2 bg-red-600 text-white rounded" onClick={async ()=>{
                try {
                  if (!donorReqDraft.donor_user_id) throw new Error('Invalid donor');
                  if (!donorReqDraft.target_datetime) throw new Error('Select date/time');
                  await api.createDonorMeetingRequest(donorReqDraft);
                  setOpenDonorReq(false);
                  setDonorReqDraft({ donor_user_id:null, blood_type:'', target_datetime:'', location_text:'' });
                  window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Request sent to donor' } }));
                } catch(e) {
                  const msg = String(e.message||'');
                  let friendly = null;
                  if (msg.toLowerCase().includes('cooldown_active')) friendly = 'Donor is on cooldown for a recent donation. Please pick a later time.';
                  window.dispatchEvent(new CustomEvent('api-error', { detail: { message: friendly || (e.message || 'Submit failed') } }));
                }
              }}>Submit</button>
            </div>
          </div>
        </div>
      )}

      {/* Recruitment Apply Modal (blood type + notes) */}
      {openApply && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-4 w-full max-w-lg shadow">
            <div className="text-lg font-semibold mb-3">Apply to Recruitment Post</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select className="border rounded px-3 py-2" value={applyDraft.blood_type} onChange={e=>setApplyDraft(v=>({...v, blood_type:e.target.value}))}>
                <option value="">Your blood type</option>
                {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bt => <option key={bt} value={bt}>{bt}</option>)}
              </select>
              <input className="border rounded px-3 py-2" placeholder="Notes (optional)" value={applyDraft.notes} onChange={e=>setApplyDraft(v=>({...v, notes:e.target.value}))} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button className="px-3 py-2 bg-gray-100 rounded" onClick={()=>setOpenApply(false)}>Cancel</button>
              <button className="px-3 py-2 bg-purple-600 text-white rounded" onClick={async ()=>{
                try {
                  if (!applyDraft.post_id) throw new Error('Invalid post');
                  if (!applyDraft.blood_type) throw new Error('Please select your blood type');
                  // Save/update donor profile with chosen blood type (optional availability_text left blank)
                  await api.upsertDonorProfile({ blood_type: applyDraft.blood_type });
                  // Apply without requiring a date/time
                  await api.applyRecruitPost(applyDraft.post_id, { availability_at: null, notes: applyDraft.notes || null });
                  setOpenApply(false);
                  setApplyDraft({ post_id:null, blood_type:'', notes:'' });
                  window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Applied successfully' } }));
                } catch(e) {
                  window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Apply failed' } }));
                }
              }}>Submit</button>
            </div>
          </div>
        </div>
      )}
      {/* Floating chat widget like Facebook bottom-right */}
      {showChat && !isMe && (
        <div className="fixed bottom-6 right-6 w-80 shadow-lg border border-gray-200 rounded-lg bg-white flex flex-col z-50">
          <div className="px-3 py-2 border-b flex items-center justify-between bg-gray-50 rounded-t-lg">
            <div className="text-sm font-semibold">Message {data.full_name || data.email}</div>
            <button className="text-gray-500 hover:text-gray-700" onClick={() => setShowChat(false)}>✕</button>
          </div>
          <div className="p-3 text-sm text-gray-500">
            Start a conversation. Your message will be delivered instantly.
          </div>
          {/* simple in-memory chat pane */}
          {chatItems.length > 0 && (
            <div className="px-3 pb-2 max-h-64 overflow-y-auto space-y-2">
              {chatItems.map(m => (
                <div key={m.id} className={`text-sm ${m.sender_user_id === me?.id ? 'text-right' : ''}`}>
                  <div className={`inline-block px-2 py-1 rounded ${m.sender_user_id === me?.id ? 'bg-purple-600 text-white' : 'bg-gray-200'}`}>{m.body}</div>
                  {m.created_at && <div className="text-[10px] text-gray-400">{new Date(m.created_at).toLocaleTimeString()}</div>}
                </div>
              ))}
            </div>
          )}
          <div className="p-3 pt-0 flex items-start space-x-2">
            <textarea
              className="flex-1 border rounded px-3 py-2 text-sm h-20 resize-none"
              placeholder="Write a message..."
              value={chatText}
              onChange={e => setChatText(e.target.value)}
            />
          </div>
          <div className="p-3 pt-0 flex items-center justify-end space-x-2">
            <button className="px-3 py-2 text-sm" onClick={() => setShowChat(false)}>Cancel</button>
            <button
              className="px-3 py-2 rounded bg-gray-800 text-white text-sm"
              disabled={msgBusy || !chatText.trim()}
              onClick={sendMessage}
            >{msgBusy ? 'Sending...' : 'Send'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function OrgAccordion({ allKeys, orgMap, groupedEntries, profileUser, initial, navigate }) {
  const prettyType = (t) => String(t || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const [open, setOpen] = React.useState(() => new Set());
  const toggle = (k) => setOpen(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const getItems = (k) => {
    const entry = groupedEntries.find(([key]) => key === k);
    return entry ? entry[1] : [];
  };
  const openOrg = async (type, idStr, name) => {
    if (type === 'fire_department') {
      navigate(`/fire-departments/${idStr}`);
      return;
    }
    if (type === 'hospital') {
      // Try canonical id first; if not found, resolve by owner id then navigate
      try {
        await api.getHospital(idStr);
        navigate(`/hospitals/${idStr}`);
        return;
      } catch (e) {
        try {
          const res = await api.getHospitalByUser(idStr);
          if (res?.id) { navigate(`/hospitals/${res.id}`); return; }
        } catch {}
      }
      navigate(`/hospitals/${idStr}`);
      return;
    }
    if (type === 'blood_bank') {
      // Blood bank pages are user profiles with role blood_bank
      navigate(`/users/${idStr}`);
      return;
    }
  };

  return (
    <div className="space-y-3">
      {allKeys.map(k => {
        const [type, idStr] = k.split(':');
        const o = orgMap[k];
        const items = getItems(k);
        const isOpen = open.has(k);
        const fallbackName = prettyType(type);
        const name = o?.name || o?.display_name || o?.title || fallbackName;
        const linkable = ['fire_department','hospital','blood_bank'].includes(type);
        return (
          <div key={k} className="border rounded-lg">
            <button className="w-full flex items-center justify-between px-3 py-2 text-left" onClick={() => toggle(k)}>
              <div className="flex items-center gap-2">
                {linkable ? (
                  <button type="button" onClick={(e)=>{ e.stopPropagation(); openOrg(type, idStr, name); }} className="font-semibold text-purple-700 hover:underline">
                    {name}
                  </button>
                ) : (
                  <span className="font-semibold">{name}</span>
                )}
              </div>
              <span className="text-xs text-gray-500">{isOpen ? 'Hide' : 'Show'} ({items.length} items)</span>
            </button>
            {isOpen && (
              <div className="p-3 space-y-3 border-t">
                {items.length === 0 ? (
                  <div className="text-sm text-gray-500">No activity yet for this organization.</div>
                ) : items.map(item => (
                  <div key={`${item.type}-${item.id}`} className="p-3 bg-white border border-gray-200 rounded-lg">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        {profileUser.avatar_url ? (
                          <img src={profileUser.avatar_url} alt="avatar" className="w-8 h-8 rounded-full object-cover border" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-purple-600 text-white flex items-center justify-center text-xs font-bold">{initial}</div>
                        )}
                        <div className="text-xs">
                          <p className="font-semibold">{profileUser.full_name || profileUser.email}</p>
                          <p className="text-[10px] text-gray-500">{item.type === 'fire_request' ? 'responded to a fire request' : item.type === 'appointment' ? 'appointment' : item.type}</p>
                        </div>
                      </div>
                      <div className="text-gray-600 text-[10px]">{item.created_at ? new Date(item.created_at).toLocaleString() : ''}</div>
                    </div>
                    {item.type === 'fire_request' ? (
                      <div>
                        {item.description && <p className="text-sm text-gray-700 whitespace-pre-line">{item.description}</p>}
                        <p className="mt-2 text-[11px] text-gray-500">Status: {item.status}</p>
                        <div className="mt-2 text-xs">
                          <Link to={`/fire/requests/${item.id}`} className="text-purple-700 hover:underline">Open request</Link>
                        </div>
                      </div>
                    ) : item.type === 'appointment' ? (
                      <div>
                        <p className="text-sm text-gray-700">Appointment ({item.role})</p>
                        <p className="text-sm text-gray-600 mt-1">{item.starts_at ? new Date(item.starts_at).toLocaleString() : ''} - {item.ends_at ? new Date(item.ends_at).toLocaleString() : ''}</p>
                        <p className="mt-2 text-[11px] text-gray-500">Status: {item.status}</p>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
