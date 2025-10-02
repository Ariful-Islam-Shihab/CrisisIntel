import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api';

export default function HospitalProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [owner, setOwner] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [dmText, setDmText] = useState('');
  const [dmBusy, setDmBusy] = useState(false);
  const [doctors, setDoctors] = useState([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [scheduleByDoctor, setScheduleByDoctor] = useState({}); // doctor_user_id -> [schedules]
  const [bookOpen, setBookOpen] = useState({}); // doctor_user_id -> boolean
  const [bookForm, setBookForm] = useState({}); // doctor_user_id -> { date, start_time, end_time }
  const [bookBlock, setBookBlock] = useState({}); // doctor_user_id -> schedule_id chosen for that date
  const [bookBusy, setBookBusy] = useState({}); // doctor_user_id -> boolean
  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [svcBook, setSvcBook] = useState({}); // service_id -> { date, time, notes?, where? lat?, lng? }
  const ambRef = React.useRef(null);
  const [svcBusy, setSvcBusy] = useState({}); // service_id -> boolean
  const [posts, setPosts] = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('doctors'); // 'posts' | 'services' | 'doctors'
  const [avatarByUser, setAvatarByUser] = useState({}); // user_id -> avatar_url|null
  // Ambulance requests are now handled via Services tab as a special service.
  // Ticket modal for appointment booking confirmation
  const [ticket, setTicket] = useState(null); // { doctor_user_id, hospital_user_id, starts_at, ends_at, serial?, approx_time? }
  // Per-doctor booked dates (to disable booking same day): { [doctor_user_id]: Set<string YYYY-MM-DD> }
  const [bookedDates, setBookedDates] = useState({});

  // Load my appointments to compute same-day flags
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.myAppointments();
        const list = res.results || res.items || [];
        const map = {};
        for (const a of list) {
          const d = String(a.starts_at || '').slice(0,10);
          if (!d) continue;
          const du = a.doctor_user_id;
          if (!du) continue;
          if (!map[du]) map[du] = new Set();
          map[du].add(d);
        }
        if (!cancelled) setBookedDates(map);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true); setError(null);
    // Fetch hospital; api.getHospital now tries canonical id first and falls back to by-user
    (async () => {
      let h = null;
      try {
        h = await api.getHospital(id);
        // If the URL param was actually a user id, redirect to canonical hospital id for stable routing
        if (h && h.id && String(h.id) !== String(id)) {
          navigate(`/hospitals/${h.id}`, { replace: true });
          return;
        }
      } catch (e) {
        setError(e.message || 'Hospital not found');
        setLoading(false);
        return;
      }

      Promise.resolve(h)
      .then(async (h) => {
        if (!mounted) return;
        setData(h);
        if (h?.user_id) {
          try { const op = await api.getUserPublic(h.user_id); if (mounted) setOwner(op || null); } catch {}
        } else { setOwner(null); }
        // fetch doctors list
        setDoctorsLoading(true);
        try {
          const targetUserId = h?.user_id || id;
          const d = await api.listHospitalDoctors(targetUserId);
          if (mounted) setDoctors(d?.results || []);
          // after doctors load, fetch their schedules filtered to this hospital
          if (mounted && d?.results && (h?.user_id || id)) {
            const hospUserId = h?.user_id || id;
            const entries = await Promise.all(
              d.results.map(async (doc) => {
                try {
                  const res = await api.listDoctorSchedule(doc.user_id);
                  const items = (res?.results || []).filter(s => String(s.hospital_user_id) === String(hospUserId));
                  return [doc.user_id, items];
                } catch {
                  return [doc.user_id, []];
                }
              })
            );
            const map = {};
            for (const [uid, items] of entries) map[uid] = items;
            if (mounted) setScheduleByDoctor(map);
          }
        }
        catch {}
        finally { if (mounted) setDoctorsLoading(false); }

        // fetch services list
        setServicesLoading(true);
        try {
          const hospUserId = h?.user_id || id;
          const res = await api.listHospitalServices(hospUserId);
          if (mounted) setServices(res?.results || []);
        } catch {}
        finally { if (mounted) setServicesLoading(false); }

        // fetch posts by owner (limited)
        if (h?.user_id) {
          setPostsLoading(true);
          try {
            const r = await api.getUserPosts(h.user_id, 20);
            if (mounted) setPosts(r?.results || []);
          } catch {}
          finally { if (mounted) setPostsLoading(false); }
        } else {
          setPosts([]);
        }
      })
      .catch(async (e) => {
        setError(e.message);
      })
      .finally(() => mounted && setLoading(false));
    })();
    return () => { mounted = false; };
  }, [id]);

  useEffect(() => {
    if (searchParams.get('ambulance') === '1') {
      setActiveTab('services');
      // Smooth scroll to ambulance card shortly after mount
      setTimeout(() => { try { ambRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} }, 200);
    }
  }, [searchParams]);

  const weekdayLabel = (n) => {
    const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    if (n === 0 || n === '0') return 'Sunday';
    const i = typeof n === 'string' ? parseInt(n, 10) : n;
    return names[i] ?? String(n);
  };

  const toggleBook = (doctorUserId) => {
    setBookOpen(o => ({ ...o, [doctorUserId]: !o[doctorUserId] }));
    setBookForm(f => {
      // If opening and no date yet, preselect the next available date based on schedules
      const cur = f[doctorUserId];
      if (cur && cur.date) return { ...f };
      const sch = scheduleByDoctor[doctorUserId] || [];
      if (!sch.length) return { ...f, [doctorUserId]: { date: '', start_time: '', end_time: '' } };
      const weekdays = [...new Set(sch.map(s => Number(s.weekday)))];
      const nextDate = computeNextDateForWeekdays(weekdays);
      const blocks = sch.filter(s => Number(s.weekday) === dateToWeekday(nextDate));
      const chosen = blocks[0];
      let start_time = '', end_time = '';
      if (chosen) {
        const options = makeTimeOptions(String(chosen.start_time).slice(0,5), String(chosen.end_time).slice(0,5), 15);
        start_time = options[0] || '';
        end_time = options[Math.min(1, options.length-1)] || '';
      }
      if (chosen) setBookBlock(b => ({ ...b, [doctorUserId]: chosen.id }));
      return { ...f, [doctorUserId]: { date: nextDate || '', start_time, end_time } };
    });
  };

  const submitBook = async (doctorUserId) => {
    const f = bookForm[doctorUserId] || {};
    if (!f.date || !f.start_time || !f.end_time) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Select date, start and end time' } }));
      return;
    }
    // Basic client-side check: ensure selected start/end is within one of the doctor's blocks for that weekday
    try {
      const schedules = scheduleByDoctor[doctorUserId] || [];
      if (schedules.length) {
        const d = new Date(f.date);
        // Map JS weekday (0=Sun) to same scheme we display
        const jsW = d.getUTCDay();
        const weekday = jsW; // our API/view expects 0=Sun already
        const blocks = schedules.filter(s => String(s.weekday) === String(weekday));
        if (blocks.length) {
          const st = (f.start_time || '').slice(0,5);
          const en = (f.end_time || '').slice(0,5);
          const ok = blocks.some(s => String(s.start_time).slice(0,5) <= st && en <= String(s.end_time).slice(0,5));
          if (!ok) {
            window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Selected time is outside doctor\'s schedule for that day' } }));
            return;
          }
        }
      }
    } catch {}
    setBookBusy(b => ({ ...b, [doctorUserId]: true }));
    try {
      const starts_at = `${f.date}T${f.start_time}:00`;
      const ends_at = `${f.date}T${f.end_time}:00`;
      const hospUserId = data?.user_id || id;
      const resp = await api.bookAppointment(doctorUserId, Number(hospUserId), starts_at, ends_at);
      const token = resp?.serial != null ? `Token #${resp.serial}` : '';
      const approx = resp?.approx_time ? ` • Approx: ${resp.approx_time}` : '';
      const msg = `Appointment booked${token||approx ? ' — ' : ''}${token}${approx}`;
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: msg } }));
      // Flash tab title briefly
      try {
        const oldTitle = document.title;
        document.title = '✓ Booked!';
        setTimeout(() => { document.title = oldTitle; }, 1800);
      } catch {}
      setBookForm(fm => ({ ...fm, [doctorUserId]: { date: '', start_time: '', end_time: '' } }));
      setBookOpen(o => ({ ...o, [doctorUserId]: false }));
      // Open ticket modal with returned details
      setTicket({
        doctor_user_id: doctorUserId,
        hospital_user_id: Number(hospUserId),
        starts_at,
        ends_at,
        serial: resp?.serial ?? null,
        approx_time: resp?.approx_time || null,
      });
      // Notify other views (e.g., Feed sidebar) to refresh appointments
      window.dispatchEvent(new CustomEvent('appointments-changed', { detail: { when: new Date().toISOString() } }));
      // Update local bookedDates cache
      setBookedDates(prev => {
        const d = (starts_at || '').slice(0,10);
        if (!d) return prev;
        const next = { ...prev };
        const set = new Set(next[doctorUserId] ? Array.from(next[doctorUserId]) : []);
        set.add(d);
        next[doctorUserId] = set;
        return next;
      });
    } catch (err) {
      const em = String(err?.message || '').toLowerCase();
      let friendly = null;
      if (em.includes('no_schedule')) friendly = "Doctor isn’t available on that day.";
      else if (em.includes('outside_schedule')) friendly = "Selected time is outside the doctor’s hours for that day.";
      else if (em.includes('capacity_full')) friendly = "All tokens for that day are full.";
      else if (em.includes('already_booked_same_day')) friendly = "You already have an appointment with this doctor that day.";
      else if (em.includes('time_conflict')) friendly = "Time conflicts with an existing appointment.";
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: friendly || (err.message || 'Failed to book appointment') } }));
    } finally {
      setBookBusy(b => ({ ...b, [doctorUserId]: false }));
    }
  };

  // ---- Booking helpers (UX) ----
  const weekdayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  function dateToWeekday(dateStr) {
    if (!dateStr) return null;
    try { const d = new Date(dateStr + 'T00:00:00'); return d.getDay(); } catch { return null; }
  }
  function pad2(n){ return String(n).padStart(2,'0'); }
  function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
  function computeNextDateForWeekdays(weekdays){
    if (!weekdays || !weekdays.length) return '';
    const today = new Date();
    for (let add=0; add<120; add++){
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate()+add);
      if (weekdays.includes(d.getDay())) return ymd(d);
    }
    return '';
  }
  function makeTimeOptions(startHH='09:00', endHH='17:00', stepMin=15){
    const out = [];
    const [sh, sm] = startHH.split(':').map(x=>parseInt(x,10));
    const [eh, em] = endHH.split(':').map(x=>parseInt(x,10));
    let t = sh*60+sm;
    const end = eh*60+em;
    while (t <= end){
      const h = Math.floor(t/60), m = t%60;
      out.push(`${pad2(h)}:${pad2(m)}`);
      t += stepMin;
    }
    return out;
  }
  function handleDateChange(doctorUserId, nextDate){
    setBookForm(f=>{
      const cur = f[doctorUserId] || { date:'', start_time:'', end_time:'' };
      const schedules = scheduleByDoctor[doctorUserId] || [];
      const wd = dateToWeekday(nextDate);
      const blocks = schedules.filter(s => Number(s.weekday) === wd);
      let start_time = cur.start_time, end_time = cur.end_time;
      let chosenId = bookBlock[doctorUserId];
      if (!blocks.length){
        start_time = ''; end_time = ''; chosenId = undefined;
      } else {
        const chosen = blocks.find(b => String(b.id) === String(chosenId)) || blocks[0];
        const opts = makeTimeOptions(String(chosen.start_time).slice(0,5), String(chosen.end_time).slice(0,5), 15);
        start_time = opts[0] || '';
        end_time = opts[Math.min(1, opts.length-1)] || '';
        chosenId = chosen.id;
      }
      setBookBlock(b=>({ ...b, [doctorUserId]: chosenId }));
      return { ...f, [doctorUserId]: { ...cur, date: nextDate, start_time, end_time } };
    });
  }
  function handleBlockChange(doctorUserId, blockId){
    const schedules = scheduleByDoctor[doctorUserId] || [];
    const b = schedules.find(s => String(s.id) === String(blockId));
    if (!b) return;
    const opts = makeTimeOptions(String(b.start_time).slice(0,5), String(b.end_time).slice(0,5), 15);
    setBookBlock(prev => ({ ...prev, [doctorUserId]: b.id }));
    setBookForm(f => ({ ...f, [doctorUserId]: { ...(f[doctorUserId]||{}), start_time: opts[0] || '', end_time: opts[Math.min(1, opts.length-1)] || '' } }));
  }
  function handleStartChange(doctorUserId, value){
    setBookForm(f=>({ ...f, [doctorUserId]: { ...(f[doctorUserId]||{}), start_time: value } }));
  }
  function handleEndChange(doctorUserId, value){
    setBookForm(f=>({ ...f, [doctorUserId]: { ...(f[doctorUserId]||{}), end_time: value } }));
  }

  // Load avatars for doctors
  useEffect(() => {
    let cancelled = false;
    if (!doctors || doctors.length === 0) { setAvatarByUser({}); return; }
    (async () => {
      try {
        const entries = await Promise.all(
          doctors.map(async (d) => {
            try {
              const u = await api.getUserPublic(d.user_id);
              return [d.user_id, u?.avatar_url || null];
            } catch {
              return [d.user_id, null];
            }
          })
        );
        if (!cancelled) {
          const map = {};
          for (const [uid, url] of entries) map[uid] = url;
          setAvatarByUser(map);
        }
      } catch {
        if (!cancelled) setAvatarByUser({});
      }
    })();
    return () => { cancelled = true; };
  }, [doctors]);

  if (loading) return <div className="p-4 bg-white border rounded">Loading...</div>;
  if (error) return (
    <div className="p-4 bg-white border rounded text-red-600">
      {error}
      {String(error).includes('not_found') && (
        <div className="text-sm text-gray-600 mt-1">This hospital was not found. If you followed a profile link, it may map to a different hospital id. Try visiting the user profile and using the Services button.</div>
      )}
    </div>
  );
  if (!data) return null;
  const amHospitalOwner = !!(me && typeof me.role === 'string' && me.role.toLowerCase().includes('hospital') && Number(me.id) === Number(data.user_id));

  return (
    <div className="p-4 bg-white border rounded space-y-2">
      {/* Appointment Ticket Modal */}
      {ticket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={()=>setTicket(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4" onClick={(e)=>e.stopPropagation()}>
            <div className="flex items-start justify-between mb-2">
              <h3 className="text-lg font-semibold">Appointment Ticket</h3>
              <button className="text-gray-500 hover:text-gray-700" onClick={()=>setTicket(null)} aria-label="Close">✕</button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center space-x-3">
                {/* Doctor avatar (if available in loaded state) */}
                {ticket.doctor_user_id && (avatarByUser[ticket.doctor_user_id] ? (
                  <img src={avatarByUser[ticket.doctor_user_id]} alt="Doctor" className="w-10 h-10 rounded-full object-cover border" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-300" />
                ))}
                <div>
                  <div className="font-semibold">Doctor #{ticket.doctor_user_id}</div>
                  <div className="text-gray-600">Hospital #{ticket.hospital_user_id}</div>
                </div>
              </div>
              <div className="pt-1">
                <div className="text-gray-800">Starts: {ticket.starts_at.replace('T',' ')}</div>
                <div className="text-gray-800">Ends: {ticket.ends_at.replace('T',' ')}</div>
                {(ticket.serial != null || ticket.approx_time) && (
                  <div className="text-gray-800">
                    {ticket.serial != null ? `Token #${ticket.serial}` : ''}{ticket.serial != null && ticket.approx_time ? ' • ' : ''}{ticket.approx_time ? `Approx: ${ticket.approx_time}` : ''}
                  </div>
                )}
              </div>
              <div className="pt-2 flex items-center justify-between">
                <button
                  className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded"
                  onClick={() => {
                    // Generate and download a simple ICS file
                    try {
                      const dt = (s) => s.replace(/[-:]/g, '').replace('T','') + 'Z';
                      const uid = `appt-${ticket.doctor_user_id}-${Date.now()}@crisisintel`;
                      const title = `Doctor Appointment (Token ${ticket.serial ?? ''})`.trim();
                      const desc = `Approx: ${ticket.approx_time || '—'}\\nDoctor #${ticket.doctor_user_id} @ Hospital #${ticket.hospital_user_id}`;
                      const ics = [
                        'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CrisisIntel//Appointments//EN','BEGIN:VEVENT',
                        `UID:${uid}`,
                        `DTSTAMP:${dt(new Date().toISOString().slice(0,19))}`,
                        `DTSTART:${dt(ticket.starts_at)}`,
                        `DTEND:${dt(ticket.ends_at)}`,
                        `SUMMARY:${title}`,
                        `DESCRIPTION:${desc}`,
                        'END:VEVENT','END:VCALENDAR'
                      ].join('\r\n');
                      const blob = new Blob([ics], { type: 'text/calendar' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = 'appointment.ics'; a.click();
                      URL.revokeObjectURL(url);
                    } catch (e) {
                      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Could not create calendar file' } }));
                    }
                  }}
                >Add to Calendar</button>
                <div className="space-x-2">
                  <button className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded" onClick={() => { setTicket(null); navigate('/appointments/mine'); }}>View Appointments</button>
                  <button className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 rounded" onClick={() => setTicket(null)}>Close</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">{data.name}</h2>
          <div className="text-sm text-gray-600">Address: {data.address || '—'}</div>
          <div className="text-sm text-gray-600">Doctor count: {data.doctor_count ?? 0}</div>
        </div>
        {data.user_id && (
          <div className="flex items-center space-x-2">
            <button
              className={`px-3 py-1.5 rounded text-sm ${owner?.is_following ? 'bg-gray-200' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
              disabled={followBusy}
              onClick={async ()=>{
                setFollowBusy(true);
                try {
                  if (owner?.is_following) await api.unfollowUser(data.user_id);
                  else await api.followUser(data.user_id);
                  try { const refreshed = await api.getUserPublic(data.user_id); setOwner(refreshed || null); } catch {}
                } catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Follow failed' } })); }
                finally { setFollowBusy(false); }
              }}
            >{followBusy ? '...' : (owner?.is_following ? 'Unfollow' : 'Follow')}</button>
            <button className="px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded text-sm" onClick={()=> setDmOpen(v=>!v)}>{dmOpen?'Close':'Message Owner'}</button>
            <button className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm" onClick={()=> { setActiveTab('services'); setTimeout(()=>{ try { ambRef.current?.scrollIntoView({ behavior:'smooth', block:'start' }); } catch {} }, 100); }}>Request Ambulance</button>
          </div>
        )}
      </div>
      {/* Tabs: Posts | Services | Doctors (buttons that switch content in-page) */}
      <div className="mt-2 flex items-center gap-2 text-sm">
        <button className={`px-3 py-1.5 border rounded ${activeTab==='posts' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100'}`} onClick={()=> setActiveTab('posts')}>
          Posts
        </button>
        <button className={`px-3 py-1.5 border rounded ${activeTab==='services' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100'}`} onClick={()=> setActiveTab('services')}>
          Services
        </button>
        <button className={`px-3 py-1.5 border rounded ${activeTab==='doctors' ? 'bg-purple-600 text-white border-purple-600' : 'bg-gray-100'}`} onClick={()=> setActiveTab('doctors')}>
          Doctors
        </button>
      </div>
      {dmOpen && data.user_id && (
        <form className="mt-3 flex items-center space-x-2" onSubmit={async (e)=>{
          e.preventDefault();
          const body = dmText.trim(); if (!body) return;
          setDmBusy(true);
          try { await api.sendDirectMessage(data.user_id, body); setDmText(''); setDmOpen(false); window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Message sent' } })); }
          catch(err){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to send' } })); }
          finally { setDmBusy(false); }
        }}>
          <input className="flex-1 p-2 bg-gray-100 rounded border border-gray-200" placeholder="Write a message…" value={dmText} onChange={e=>setDmText(e.target.value)} disabled={dmBusy} />
          <button type="submit" className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm" disabled={dmBusy || !dmText.trim()}>{dmBusy?'Sending…':'Send'}</button>
        </form>
      )}
      {/* Standalone ambulance form removed in favor of booking via Services tab. */}
      {/* Tab content */}
      {activeTab === 'posts' && (
        <section className="mt-4">
          <h3 className="font-semibold mb-2">Recent Posts</h3>
          {postsLoading && <div className="text-sm text-gray-500">Loading posts…</div>}
          {!postsLoading && posts.length === 0 && <div className="text-sm text-gray-500">No posts yet</div>}
          <ul className="space-y-2">
            {posts.map(p => (
              <li key={p.id} className="p-3 bg-gray-50 border rounded">
                <div className="text-gray-800 mb-1">{p.body}</div>
                <Link to={`/posts/${p.id}`} className="text-purple-700 hover:underline text-sm">View</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeTab === 'services' && (
        <section className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Services</h3>
            {amHospitalOwner && (
              <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm" onClick={()=> navigate(`/hospitals/${id}/services`)}>Manage Services</button>
            )}
          </div>
          {servicesLoading && <div className="text-sm text-gray-500">Loading services…</div>}
          {!servicesLoading && services.length === 0 && <div className="text-sm text-gray-500">No services yet</div>}
          <ul className="space-y-3">
            {services.map(s => {
              const isAmb = String(s.name || '').toLowerCase().includes('ambulance');
              const f = svcBook[s.id] || {};
              return (
                <li key={s.id} ref={isAmb ? ambRef : undefined} className="text-sm p-3 bg-gray-50 border rounded">
                  <div className="flex items-start justify-between">
                    <div className="pr-3">
                      <div className="text-gray-900">
                        {s.name}
                        {isAmb && <span className="ml-2 inline-block px-2 py-0.5 text-xs rounded bg-red-100 text-red-700 align-middle">Emergency</span>}
                        {!isAmb && <span> — ${Number(s.price || 0).toFixed(2)} • {s.duration_minutes} min</span>}
                      </div>
                      {s.description ? <div className="text-gray-600">{s.description}</div> : null}
                      <div className="text-gray-700">
                        {s.max_per_day ? <span className="mr-3">Max/Day: {s.max_per_day}</span> : null}
                        {(s.window_start_time && s.window_end_time) ? (
                          <span>Booking Window: {String(s.window_start_time).slice(0,5)} – {String(s.window_end_time).slice(0,5)}</span>
                        ) : (
                          <span>Booking Window: Any time</span>
                        )}
                      </div>
                      {isAmb && (
                        <div className="mt-2 p-2 bg-white border rounded">
                          <div className="text-[13px] text-gray-700 mb-2">Ambulance requests use current date/time automatically and are tracked under Services.</div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
                            <div className="text-xs text-gray-600">Dispatch time: now</div>
                            <div className="flex items-center gap-2 md:col-span-2">
                              <input className="flex-1 p-1 bg-gray-100 border rounded" placeholder="Where are you? (lat, lng or address)" value={f.where||''} onChange={e=>setSvcBook(v=>({ ...v, [s.id]: { ...(v[s.id]||{}), where: e.target.value } }))} />
                              <button type="button" className="px-2 py-1 text-xs bg-gray-800 text-white rounded" onClick={()=>{
                                if (!navigator.geolocation) { window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Geolocation not supported' } })); return; }
                                navigator.geolocation.getCurrentPosition((p)=>{
                                  const lat = p.coords.latitude.toFixed(6); const lng = p.coords.longitude.toFixed(6);
                                  setSvcBook(v=>({ ...v, [s.id]: { ...(v[s.id]||{}), where: `${lat}, ${lng}`, lat, lng } }));
                                  window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:`Location set to ${lat}, ${lng}` } }));
                                }, (err)=>{
                                  window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Unable to get location' } }));
                                }, { enableHighAccuracy: true, timeout: 8000 });
                              }}>Use current</button>
                            </div>
                            <textarea className="md:col-span-3 p-1 bg-gray-100 border rounded" rows={2} placeholder="Describe the emergency and any details…" value={f.notes||''} onChange={e=>setSvcBook(v=>({ ...v, [s.id]: { ...(v[s.id]||{}), notes: e.target.value } }))} />
                          </div>
                        </div>
                      )}
                      {!isAmb && (
                        <div className="mt-2 p-2 bg-white border rounded">
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                            <div className="md:col-span-2">
                              <label className="block text-xs text-gray-600 mb-1">Date</label>
                              <input type="date" className="w-full p-1 bg-gray-100 border rounded" value={f.date||''} onChange={e=>setSvcBook(v=>({ ...v, [s.id]: { ...(v[s.id]||{}), date: e.target.value, err: undefined } }))} />
                            </div>
                            <div className="md:col-span-2">
                              <label className="block text-xs text-gray-600 mb-1">Time</label>
                              {(() => {
                                const ws = s.window_start_time ? String(s.window_start_time).slice(0,5) : '';
                                const we = s.window_end_time ? String(s.window_end_time).slice(0,5) : '';
                                return (
                                  <input type="time" className="w-full p-1 bg-gray-100 border rounded" value={f.time||''}
                                    min={ws || undefined}
                                    max={we || undefined}
                                    onChange={e=>setSvcBook(v=>({ ...v, [s.id]: { ...(v[s.id]||{}), time: e.target.value, err: undefined } }))} />
                                );
                              })()}
                              {s.window_start_time && s.window_end_time && (
                                <div className="mt-1 text-[11px] text-gray-500">Window: {String(s.window_start_time).slice(0,5)}–{String(s.window_end_time).slice(0,5)}</div>
                              )}
                            </div>
                            <div className="md:col-span-4">
                              <label className="block text-xs text-gray-600 mb-1">Notes (optional)</label>
                              <textarea className="w-full p-1 bg-gray-100 border rounded" rows={2} placeholder="Any details for this service…" value={f.notes||''} onChange={e=>setSvcBook(v=>({ ...v, [s.id]: { ...(v[s.id]||{}), notes: e.target.value } }))} />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                          <button className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm" onClick={async ()=>{
                        const ff = svcBook[s.id] || {};
                        setSvcBusy(b=>({ ...b, [s.id]: true }));
                        try {
                          let scheduled_at = null;
                          const hospUserId = data?.user_id || id;
                          let lat = null, lng = null;
                          if (ff.where) {
                            try { const m = String(ff.where).match(/\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)/); if (m) { lat = parseFloat(m[1]); lng = parseFloat(m[2]); } } catch {}
                          }
                          let resp = null;
                          if (isAmb) {
                            resp = await api.bookServiceWithDetails(s.id, Number(hospUserId), null, ff.notes || '', lat, lng);
                          } else {
                            // Require date/time; prefill sensible defaults and show inline hint instead of throwing
                            if (!ff.date || !ff.time) {
                              const now = new Date();
                              const today = now.toISOString().slice(0,10);
                              const ws = s.window_start_time ? String(s.window_start_time).slice(0,5) : '09:00';
                              setSvcBook(v=>({ ...v, [s.id]: { ...(v[s.id]||{}), date: ff.date || today, time: ff.time || ws, err: 'Please select date and time.' } }));
                              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Please select date and time' } }));
                              return;
                            }
                            // Client-side window validation for better UX (backend also enforces)
                            const ws = s.window_start_time ? String(s.window_start_time).slice(0,5) : null;
                            const we = s.window_end_time ? String(s.window_end_time).slice(0,5) : null;
                            if (ws && we && ff.time) {
                              const toMin = (hhmm) => { try { const [h,m]=hhmm.split(':'); return (+h)*60+(+m); } catch { return null; } };
                              const tmin = toMin(ff.time), wmin = toMin(ws), emin = toMin(we);
                              if (tmin!=null && wmin!=null && emin!=null && (tmin < wmin || tmin > emin)) {
                                setSvcBook(v=>({ ...v, [s.id]: { ...(v[s.id]||{}), err: `Please choose a time between ${ws} and ${we}.` } }));
                                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: `Please choose a time between ${ws} and ${we}.` } }));
                                return;
                              }
                            }
                            scheduled_at = `${ff.date}T${ff.time}:00`;
                            resp = await api.bookServiceWithDetails(s.id, Number(hospUserId), scheduled_at, ff.notes || '', null, null);
                          }
                          const token = resp?.serial != null ? `Token #${resp.serial}` : '';
                          const approx = resp?.approx_time ? ` • Approx: ${resp.approx_time}` : '';
                          const msg = `${isAmb ? 'Ambulance requested' : 'Service booked'}${token||approx ? ' — ' : ''}${token}${approx}`;
                          window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: msg } }));
                          // Refresh user bookings UI (e.g., feed sidebar)
                          window.dispatchEvent(new CustomEvent('service-bookings-changed'));
                          setSvcBook(v => ({ ...v, [s.id]: { date: '', time: '', notes: '', where: '' } }));
                          try { setTimeout(()=>navigate('/feed'), 300); } catch {}
                        } catch(err) {
                          window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || (isAmb ? 'Failed to request ambulance' : 'Failed to book service') } }));
                        } finally {
                          setSvcBusy(b=>({ ...b, [s.id]: false }));
                        }
                      }} disabled={!!svcBusy[s.id]}>{svcBusy[s.id] ? (isAmb?'Requesting…':'Booking…') : (isAmb?'Request Ambulance':'Book')}</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {activeTab === 'doctors' && (
        <section className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Doctors</h3>
            {amHospitalOwner && (
              <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm" onClick={()=> navigate(`/hospitals/${id}/doctors/manage`)}>Manage Doctors</button>
            )}
          </div>
          {doctorsLoading && <div className="text-sm text-gray-500">Loading doctors…</div>}
          {!doctorsLoading && doctors.length === 0 && <div className="text-sm text-gray-500">No doctors yet</div>}
          <ul className="space-y-3">
            {doctors.map(d => {
              const schedules = scheduleByDoctor[d.user_id] || [];
              return (
                <li key={d.user_id} className="text-sm p-3 bg-gray-50 border rounded">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start pr-3">
                      <div className="mr-3">
                        {avatarByUser[d.user_id] ? (
                          <img src={avatarByUser[d.user_id]} alt="Doctor avatar" className="w-10 h-10 rounded-full object-cover border" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gray-300" />
                        )}
                      </div>
                      <div>
                        <div className="text-gray-900">
                          <Link className="text-purple-700 hover:underline" to={`/doctors/${d.user_id}`}>{d.doctor_name || d.full_name || d.email || `Doctor #${d.user_id}`}</Link>
                          {d.specialty ? <span className="text-gray-600"> — {d.specialty}</span> : null}
                        </div>
                        <div className="text-gray-700">
                          {schedules.length === 0 ? (
                            <span className="text-gray-500">No schedule published</span>
                          ) : (
                            <ul className="list-disc ml-5">
                              {schedules.map(s => (
                                <li key={s.id}>
                                  {weekdayLabel(s.weekday)} {s.start_time} – {s.end_time}
                                  {s.visit_cost != null ? <span> (${Number(s.visit_cost).toFixed(2)})</span> : null}
                                  {s.max_per_day ? <span className="text-gray-500"> • max {s.max_per_day}/day</span> : null}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="pl-3">
                      <button className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm" onClick={()=>toggleBook(d.user_id)}>
                        {bookOpen[d.user_id] ? 'Close' : 'Book'}
                      </button>
                    </div>
                  </div>
                  {bookOpen[d.user_id] && (
                    <div className="mt-2 space-y-2">
                      {/* Weekday chips */}
                      <div className="flex flex-wrap items-center gap-1 text-xs text-gray-700">
                        <span className="mr-1">Available days:</span>
                        {([...new Set((scheduleByDoctor[d.user_id]||[]).map(s=>Number(s.weekday)))])
                          .sort((a,b)=>a-b)
                          .map(w => (
                            <button key={w} type="button" className="px-2 py-1 rounded border bg-gray-100 hover:bg-gray-200"
                              onClick={()=> handleDateChange(d.user_id, computeNextDateForWeekdays([w]))}>
                              {weekdayNames[w]}
                            </button>
                          ))}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <label className="text-sm">Date
                          <input type="date" className="w-full p-2 bg-gray-100 border rounded" value={(bookForm[d.user_id]?.date)||''} onChange={e=>handleDateChange(d.user_id, e.target.value)} />
                        </label>
                        {/* Block selector for the selected date */}
                        <label className="text-sm md:col-span-1">Block
                          <select className="w-full p-2 bg-gray-100 border rounded" value={(bookBlock[d.user_id]||'')}
                            onChange={e=>handleBlockChange(d.user_id, e.target.value)}>
                            {(scheduleByDoctor[d.user_id]||[])
                              .filter(s => String(s.weekday) === String(dateToWeekday(bookForm[d.user_id]?.date)))
                              .map(s => (
                                <option key={s.id} value={s.id}>{String(s.start_time).slice(0,5)} – {String(s.end_time).slice(0,5)}</option>
                              ))}
                          </select>
                        </label>
                        <label className="text-sm">Start
                          <select className="w-full p-2 bg-gray-100 border rounded" value={(bookForm[d.user_id]?.start_time)||''}
                            onChange={e=>handleStartChange(d.user_id, e.target.value)}>
                            {(() => {
                              const s = (scheduleByDoctor[d.user_id]||[]).find(x => String(x.id) === String(bookBlock[d.user_id]));
                              const opts = s ? makeTimeOptions(String(s.start_time).slice(0,5), String(s.end_time).slice(0,5), 15) : [];
                              return opts.map(o => <option key={o} value={o}>{o}</option>);
                            })()}
                          </select>
                        </label>
                        <label className="text-sm">End
                          <select className="w-full p-2 bg-gray-100 border rounded" value={(bookForm[d.user_id]?.end_time)||''}
                            onChange={e=>handleEndChange(d.user_id, e.target.value)}>
                            {(() => {
                              const s = (scheduleByDoctor[d.user_id]||[]).find(x => String(x.id) === String(bookBlock[d.user_id]));
                              const startSel = (bookForm[d.user_id]?.start_time)||'00:00';
                              const opts = s ? makeTimeOptions(startSel, String(s.end_time).slice(0,5), 15).slice(1) : [];
                              return opts.map(o => <option key={o} value={o}>{o}</option>);
                            })()}
                          </select>
                        </label>
                      </div>
                      {(() => {
                        const wd = dateToWeekday(bookForm[d.user_id]?.date);
                        const hasBlocks = (scheduleByDoctor[d.user_id]||[]).some(s => Number(s.weekday) === wd);
                        return !hasBlocks ? <div className="text-xs text-red-600">No schedule on the selected day. Pick a suggested day above.</div> : null;
                      })()}
                      <div>
                        <button className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm" onClick={()=>submitBook(d.user_id)} disabled={!!bookBusy[d.user_id]}>
                          {bookBusy[d.user_id] ? 'Booking…' : 'Confirm Booking'}
                        </button>
                        {(() => {
                          const dstr = (bookForm[d.user_id]?.date) || '';
                          const already = dstr && bookedDates[d.user_id] && bookedDates[d.user_id].has(dstr);
                          return already ? (
                            <div className="text-xs text-amber-700 mt-1">You already have an appointment with this doctor on {dstr}.</div>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
