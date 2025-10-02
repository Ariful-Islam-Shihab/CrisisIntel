import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api';

export default function DoctorProfile() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [owner, setOwner] = useState(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [dmText, setDmText] = useState('');
  const [dmBusy, setDmBusy] = useState(false);
  const [schedule, setSchedule] = useState([]);
  const [schedLoading, setSchedLoading] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [book, setBook] = useState({ hospital_user_id: '', date: '', start_time: '', end_time: '' });
  const [bookBusy, setBookBusy] = useState(false);
  const hospitals = useMemo(() => {
    const set = new Map();
    for (const s of schedule) {
      if (s.hospital_user_id) set.set(s.hospital_user_id, true);
    }
    return Array.from(set.keys());
  }, [schedule]);

  useEffect(() => {
    let mounted = true;
    setLoading(true); setError(null);
    api.getDoctor(id)
      .then(async (doc) => {
        if (!mounted) return;
        setData(doc);
        if (doc?.user?.id) {
          try { const op = await api.getUserPublic(doc.user.id); if (mounted) setOwner(op || null); } catch {}
        } else { setOwner(null); }
        // load schedule blocks
        setSchedLoading(true);
        try { const res = await api.listDoctorSchedule(id); if (mounted) setSchedule(res?.results || []); }
        catch {}
        finally { if (mounted) setSchedLoading(false); }
      })
      .catch(e => setError(e.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [id]);

  if (loading) return <div className="p-4 bg-white border rounded">Loading...</div>;
  if (error) return <div className="p-4 bg-white border rounded text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="p-4 bg-white border rounded space-y-2">
      <div className="flex items-start justify-between">
        <div>
          <section className="mt-3">
            <h3 className="font-semibold mb-2">Schedule</h3>
            {schedLoading && <div className="text-sm text-gray-500">Loading schedule…</div>}
            {!schedLoading && schedule.length === 0 && <div className="text-sm text-gray-500">No schedule yet</div>}
            <ul className="space-y-1">
              {schedule.map((s) => (
                <li key={s.id} className="text-sm text-gray-700">
                  Hospital User #{s.hospital_user_id} — Day {s.weekday}, {s.start_time} - {s.end_time}
                </li>
              ))}
            </ul>
          </section>

          {data.user?.id && (
            <section className="mt-4">
              <button className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm" onClick={()=> setBookOpen(v=>!v)}>{bookOpen?'Close Booking':'Book Appointment'}</button>
              {bookOpen && (
                <form className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2" onSubmit={async (e)=>{
                  e.preventDefault();
                  if (!book.hospital_user_id || !book.date || !book.start_time || !book.end_time) return;
                  setBookBusy(true);
                  try {
                    const starts_at = `${book.date}T${book.start_time}:00`;
                    const ends_at = `${book.date}T${book.end_time}:00`;
                    const resp = await api.bookAppointment(data.user.id, Number(book.hospital_user_id), starts_at, ends_at);
                    const token = resp?.serial != null ? `Token #${resp.serial}` : '';
                    const approx = resp?.approx_time ? ` • Approx: ${resp.approx_time}` : '';
                    const msg = `Appointment booked${token||approx ? ' — ' : ''}${token}${approx}`;
                    window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: msg } }));
                    setBook({ hospital_user_id: '', date: '', start_time: '', end_time: '' });
                    setBookOpen(false);
                  } catch(err) {
                    window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to book' } }));
                  } finally { setBookBusy(false); }
                }}>
                  <label className="text-sm">
                    Hospital (user id)
                    <select className="w-full p-2 bg-gray-100 border rounded" value={book.hospital_user_id}
                            onChange={e=>setBook(v=>({...v, hospital_user_id: e.target.value}))}>
                      <option value="">Select…</option>
                      {hospitals.map(hid => <option key={hid} value={hid}>{hid}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">
                    Date
                    <input type="date" className="w-full p-2 bg-gray-100 border rounded" value={book.date}
                           onChange={e=>setBook(v=>({...v, date: e.target.value}))} />
                  </label>
                  <label className="text-sm">
                    Start time
                    <input type="time" className="w-full p-2 bg-gray-100 border rounded" value={book.start_time}
                           onChange={e=>setBook(v=>({...v, start_time: e.target.value}))} />
                  </label>
                  <label className="text-sm">
                    End time
                    <input type="time" className="w-full p-2 bg-gray-100 border rounded" value={book.end_time}
                           onChange={e=>setBook(v=>({...v, end_time: e.target.value}))} />
                  </label>
                  <div className="col-span-full">
                    <button type="submit" className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm" disabled={bookBusy}>
                      {bookBusy ? 'Booking…' : 'Confirm Booking'}
                    </button>
                  </div>
                </form>
              )}
            </section>
          )}
          <h2 className="text-xl font-semibold">{data.name}</h2>
          <div className="text-sm text-gray-600">Specialty: {data.specialty || '—'}</div>
          {data.user && (
            <div className="text-sm">
              User: <Link className="text-purple-700 hover:underline" to={`/users/${data.user.id}`}>{data.user.full_name || data.user.email}</Link>
            </div>
          )}
        </div>
        {data.user?.id && (
          <div className="flex items-center space-x-2">
            <button
              className={`px-3 py-1.5 rounded text-sm ${owner?.is_following ? 'bg-gray-200' : 'bg-purple-600 text-white hover:bg-purple-700'}`}
              disabled={followBusy}
              onClick={async ()=>{
                setFollowBusy(true);
                try {
                  if (owner?.is_following) await api.unfollowUser(data.user.id);
                  else await api.followUser(data.user.id);
                  try { const refreshed = await api.getUserPublic(data.user.id); setOwner(refreshed || null); } catch {}
                } catch(e){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Follow failed' } })); }
                finally { setFollowBusy(false); }
              }}
            >{followBusy ? '...' : (owner?.is_following ? 'Unfollow' : 'Follow')}</button>
            <button className="px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded text-sm" onClick={()=> setDmOpen(v=>!v)}>{dmOpen?'Close':'Message'}</button>
          </div>
        )}
      </div>
      {dmOpen && data.user?.id && (
        <form className="mt-3 flex items-center space-x-2" onSubmit={async (e)=>{
          e.preventDefault();
          const body = dmText.trim(); if (!body) return;
          setDmBusy(true);
          try { await api.sendDirectMessage(data.user.id, body); setDmText(''); setDmOpen(false); window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Message sent' } })); }
          catch(err){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to send' } })); }
          finally { setDmBusy(false); }
        }}>
          <input className="flex-1 p-2 bg-gray-100 rounded border border-gray-200" placeholder="Write a message…" value={dmText} onChange={e=>setDmText(e.target.value)} disabled={dmBusy} />
          <button type="submit" className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm" disabled={dmBusy || !dmText.trim()}>{dmBusy?'Sending…':'Send'}</button>
        </form>
      )}
    </div>
  );
}
