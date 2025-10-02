import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';

export default function HospitalServices() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const { id: routeHospitalId } = useParams();
  const [resolvedUserId, setResolvedUserId] = useState(null);
  const hospitalUserId = resolvedUserId ?? (routeHospitalId ? Number(routeHospitalId) : me?.id);
  const isHospital = typeof me?.role === 'string' && me.role.toLowerCase().includes('hospital') && Number(me?.id) === Number(hospitalUserId);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', price: '', duration_minutes: 30, available: true, max_per_day: '', window_start_time: '', window_end_time: '' });
  const [busy, setBusy] = useState(false);
  const [bookBusy, setBookBusy] = useState({});
  const [bookDate, setBookDate] = useState('');
  const [bookTime, setBookTime] = useState('');
  const [myBookings, setMyBookings] = useState([]); // for disabling already-booked days per service
  const [editingId, setEditingId] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', description: '', price: '', duration_minutes: '', available: true, max_per_day: '', window_start_time: '', window_end_time: '' });
  const predefinedServices = [
    // Imaging
    'X-ray',
    'Ultrasound (Sonography)',
    'Doppler Ultrasound',
    'CT Scan',
    'MRI',
    'PET Scan',
    'Mammography',
    // Endoscopy/Scopes
    'Colonoscopy',
    'Endoscopy (Upper GI)',
    'Gastroscopy',
    // Cardio/Neuro Diagnostics
    'ECG / EKG',
    'Echocardiogram (ECHO)',
    'EEG',
    // Lab Tests
    'Blood Test (CBC)',
    'Lipid Profile',
    'Liver Function Test (LFT)',
    'Kidney Function Test (KFT)',
    'Urine Analysis',
    'Stool Test',
    // Women’s Health
    'Pap Smear',
    'Prenatal Ultrasound',
    // Other Common Services
    'Vaccination',
    'COVID-19 Test',
    'Dialysis',
    'Physiotherapy',
    'General Consultation'
  ];

  const refresh = async () => {
    if (!hospitalUserId) return;
    setLoading(true); setError(null);
    try { const r = await api.request(`/hospitals/${hospitalUserId}/services/list`); setList(r?.results || []); }
    catch(e){ setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      // If route has :id, resolve to owner user_id via getHospital
      if (routeHospitalId) {
        try {
          const h = await api.getHospital(routeHospitalId);
          if (mounted) setResolvedUserId(h?.user_id || Number(routeHospitalId));
        } catch {
          if (mounted) setResolvedUserId(Number(routeHospitalId));
        }
      } else {
        setResolvedUserId(me?.id ?? null);
      }
    })();
    return () => { mounted = false; };
  }, [routeHospitalId, me?.id]);

  useEffect(() => { refresh(); }, [hospitalUserId]);

  // Load my service bookings once to determine if a service is already booked for a selected day
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await api.myServiceBookings?.();
        if (mounted) setMyBookings((r?.results || r?.items || []).filter(x => x.status === 'booked'));
      } catch {
        // best effort; if API wrapper differs, ignore
      }
    })();
    return () => { mounted = false; };
  }, []);

  const add = async (e) => {
    e.preventDefault(); if (!isHospital) return;
  const body = { ...form, price: Number(form.price || 0), duration_minutes: Number(form.duration_minutes || 30), available: !!form.available };
  if (body.max_per_day !== '') body.max_per_day = Number(body.max_per_day);
  if (!body.window_start_time) delete body.window_start_time;
  if (!body.window_end_time) delete body.window_end_time;
    setBusy(true);
    try { await api.request(`/hospitals/${hospitalUserId}/services/add`, 'POST', body); await refresh(); setForm({ name: '', description: '', price: '', duration_minutes: 30, available: true, max_per_day: '', window_start_time: '', window_end_time: '' }); }
    catch(err){ window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to add service' } })); }
    finally { setBusy(false); }
  };

  const withinWindow = (svc, timeHHMM) => {
    const ws = svc.window_start_time ? String(svc.window_start_time).slice(0,5) : '';
    const we = svc.window_end_time ? String(svc.window_end_time).slice(0,5) : '';
    if (!ws && !we) return true;
    if (ws && we) return ws <= timeHHMM && timeHHMM <= we;
    if (ws && !we) return timeHHMM >= ws; // start-only means no earlier than ws
    if (!ws && we) return timeHHMM <= we; // end-only means no later than we
    return true;
  };

  const book = async (svc) => {
    setBookBusy(b => ({ ...b, [svc.id]: true }));
    try {
      if (!bookDate || !bookTime) throw new Error('Select date and time');
      if (!svc.available) throw new Error('Service unavailable');
      if (!withinWindow(svc, bookTime)) throw new Error('Selected time is outside service booking window');
      const scheduled_at = `${bookDate}T${bookTime}:00`;
  const resp = await api.request('/services/book', 'POST', { service_id: svc.id, hospital_user_id: hospitalUserId, scheduled_at });
  const token = resp?.serial != null ? `Token #${resp.serial}` : '';
  const approx = resp?.approx_time ? ` • Approx: ${resp.approx_time}` : '';
  const msg = `Service booked${token||approx ? ' — ' : ''}${token}${approx}`;
  window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: msg } }));
      setBookDate(''); setBookTime('');
      // update local myBookings so the button disables for that date going forward
      try {
        const when = resp?.approx_time ? `${bookDate} ${resp.approx_time}` : `${bookDate} ${bookTime}`;
        setMyBookings(prev => ([...prev, { id: resp?.id || Math.random(), service_id: svc.id, scheduled_at: when, status: 'booked' }]));
      } catch {}
    } catch(err) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to book service' } }));
    } finally {
      setBookBusy(b => ({ ...b, [svc.id]: false }));
    }
  };

  const beginEdit = (svc) => {
    setEditingId(svc.id);
    setEditForm({
      name: svc.name || '',
      description: svc.description || '',
      price: svc.price ?? '',
      duration_minutes: svc.duration_minutes ?? '',
      available: svc.available ?? true,
      max_per_day: svc.max_per_day ?? '',
      window_start_time: svc.window_start_time ? String(svc.window_start_time).slice(0,5) : '',
      window_end_time: svc.window_end_time ? String(svc.window_end_time).slice(0,5) : '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setEditBusy(true);
    try {
      const patch = {
        name: editForm.name,
        description: editForm.description,
        price: editForm.price !== '' ? Number(editForm.price) : null,
        duration_minutes: editForm.duration_minutes !== '' ? Number(editForm.duration_minutes) : null,
        available: !!editForm.available,
        max_per_day: editForm.max_per_day !== '' ? Number(editForm.max_per_day) : null,
        window_start_time: editForm.window_start_time || null,
        window_end_time: editForm.window_end_time || null,
      };
      await api.request(`/hospitals/${hospitalUserId}/services/${editingId}/update`, 'POST', patch);
      await refresh();
      setEditingId(null);
    } catch(err) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to update service' } }));
    } finally {
      setEditBusy(false);
    }
  };

  const removeService = async (svcId) => {
    if (!window.confirm('Delete this service?')) return;
    setEditBusy(true);
    try {
      await api.request(`/hospitals/${hospitalUserId}/services/${svcId}/delete`, 'POST', {});
      await refresh();
      if (editingId === svcId) setEditingId(null);
    } catch(err) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to delete service' } }));
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <div className="p-4 bg-white border rounded">
      <h2 className="text-xl font-semibold mb-3">Hospital Services</h2>
      {isHospital && (
        <form className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4" onSubmit={add}>
          <label className="text-sm">
            Name
            <div className="flex gap-2">
              <select className="w-1/2 p-2 bg-gray-100 border rounded" value={predefinedServices.includes(form.name) ? form.name : ''} onChange={e=>{
                const val = e.target.value;
                setForm(v=>({...v, name: val || v.name}));
              }}>
                <option value="">-- Select common --</option>
                {predefinedServices.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <input className="w-1/2 p-2 bg-gray-100 border rounded" placeholder="Or type custom" value={form.name} onChange={e=>setForm(v=>({...v, name: e.target.value}))} required />
            </div>
          </label>
          <label className="text-sm">
            Price
            <input type="number" step="0.01" className="w-full p-2 bg-gray-100 border rounded" value={form.price} onChange={e=>setForm(v=>({...v, price: e.target.value}))} />
          </label>
          <label className="text-sm md:col-span-2">
            Description
            <input className="w-full p-2 bg-gray-100 border rounded" value={form.description} onChange={e=>setForm(v=>({...v, description: e.target.value}))} />
          </label>
          <label className="text-sm">
            Duration (minutes)
            <input type="number" className="w-full p-2 bg-gray-100 border rounded" value={form.duration_minutes} onChange={e=>setForm(v=>({...v, duration_minutes: e.target.value}))} />
          </label>
          <label className="text-sm">
            Max Patients/Day
            <input type="number" className="w-full p-2 bg-gray-100 border rounded" value={form.max_per_day} onChange={e=>setForm(v=>({...v, max_per_day: e.target.value}))} />
          </label>
          <label className="text-sm">
            Booking Window Start (HH:MM)
            <input type="time" className="w-full p-2 bg-gray-100 border rounded" value={form.window_start_time} onChange={e=>setForm(v=>({...v, window_start_time: e.target.value}))} />
          </label>
          <label className="text-sm">
            Booking Window End (HH:MM)
            <input type="time" className="w-full p-2 bg-gray-100 border rounded" value={form.window_end_time} onChange={e=>setForm(v=>({...v, window_end_time: e.target.value}))} />
          </label>
          <label className="text-sm flex items-center space-x-2">
            <input type="checkbox" checked={form.available} onChange={e=>setForm(v=>({...v, available: e.target.checked}))} />
            <span>Available</span>
          </label>
          <div className="col-span-full">
            <button type="submit" className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm" disabled={busy}>{busy?'Saving…':'Add Service'}</button>
          </div>
        </form>
      )}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      <ul className="divide-y">
        {list.map(s => {
          const isEditing = editingId === s.id;
          const isBookedForSelectedDay = (() => {
            if (!bookDate) return false;
            const day = String(bookDate);
            return myBookings.some(b => b.service_id === s.id && String(b.scheduled_at).slice(0,10) === day && b.status === 'booked');
          })();
          return (
            <li key={s.id} className="py-2 text-sm">
              {!isHospital && (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-gray-800">{s.name} — ${Number(s.price || 0).toFixed(2)} • {s.duration_minutes} min</div>
                    <div className="text-gray-500">{s.description || ''}</div>
                    <div className="text-gray-600">
                      {s.max_per_day ? <span className="mr-3">Max/Day: {s.max_per_day}</span> : null}
                      {(s.window_start_time && s.window_end_time) ? <span>Booking Window: {String(s.window_start_time).slice(0,5)} – {String(s.window_end_time).slice(0,5)}</span> : <span>Booking Window: Any time</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="date" className="p-1 bg-gray-100 border rounded" value={bookDate} onChange={e=>setBookDate(e.target.value)} />
                    <input type="time" className="p-1 bg-gray-100 border rounded" value={bookTime} onChange={e=>setBookTime(e.target.value)} />
                    <button className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-sm disabled:opacity-50" onClick={()=>book(s)} disabled={bookBusy[s.id] || !s.available || !bookDate || !bookTime || isBookedForSelectedDay}>
                      {isBookedForSelectedDay ? 'Booked' : (bookBusy[s.id] ? 'Booking…' : 'Book')}
                    </button>
                  </div>
                </div>
              )}

              {isHospital && !isEditing && (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-gray-800">{s.name} — ${Number(s.price || 0).toFixed(2)} • {s.duration_minutes} min</div>
                    <div className="text-gray-500">{s.description || ''}</div>
                    <div className="text-gray-600">
                      {s.max_per_day ? <span className="mr-3">Max/Day: {s.max_per_day}</span> : null}
                      {(s.window_start_time && s.window_end_time) ? <span>Booking Window: {String(s.window_start_time).slice(0,5)} – {String(s.window_end_time).slice(0,5)}</span> : <span>Booking Window: Any time</span>}
                      <span className="ml-3">{s.available ? 'Available' : 'Unavailable'}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm" onClick={()=>beginEdit(s)}>Edit</button>
                    <button className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm" onClick={()=>removeService(s.id)} disabled={editBusy}>Delete</button>
                  </div>
                </div>
              )}

              {isHospital && isEditing && (
                <div className="grid gap-2">
                  <label className="text-sm">
                    Name
                    <input className="w-full p-2 bg-gray-100 border rounded" value={editForm.name} onChange={e=>setEditForm(v=>({...v, name: e.target.value}))} />
                  </label>
                  <label className="text-sm">
                    Description
                    <textarea className="w-full p-2 bg-gray-100 border rounded" value={editForm.description} onChange={e=>setEditForm(v=>({...v, description: e.target.value}))} />
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <label className="text-sm">Price ($)
                      <input type="number" step="0.01" className="w-full p-2 bg-gray-100 border rounded" value={editForm.price} onChange={e=>setEditForm(v=>({...v, price: e.target.value}))} />
                    </label>
                    <label className="text-sm">Duration (min)
                      <input type="number" className="w-full p-2 bg-gray-100 border rounded" value={editForm.duration_minutes} onChange={e=>setEditForm(v=>({...v, duration_minutes: e.target.value}))} />
                    </label>
                    <label className="text-sm">Max Patients/Day
                      <input type="number" className="w-full p-2 bg-gray-100 border rounded" value={editForm.max_per_day} onChange={e=>setEditForm(v=>({...v, max_per_day: e.target.value}))} />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <label className="text-sm">Booking Window Start
                      <input type="time" className="w-full p-2 bg-gray-100 border rounded" value={editForm.window_start_time} onChange={e=>setEditForm(v=>({...v, window_start_time: e.target.value}))} />
                    </label>
                    <label className="text-sm">Booking Window End
                      <input type="time" className="w-full p-2 bg-gray-100 border rounded" value={editForm.window_end_time} onChange={e=>setEditForm(v=>({...v, window_end_time: e.target.value}))} />
                    </label>
                  </div>
                  <label className="text-sm inline-flex items-center gap-2">
                    <input type="checkbox" checked={!!editForm.available} onChange={e=>setEditForm(v=>({...v, available: e.target.checked}))} /> Available
                  </label>
                  <div className="flex gap-2">
                    <button className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm" onClick={saveEdit} disabled={editBusy}>{editBusy ? 'Saving…' : 'Save'}</button>
                    <button className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded text-sm" onClick={cancelEdit}>Cancel</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}