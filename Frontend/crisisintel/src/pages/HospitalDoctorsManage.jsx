import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api';

export default function HospitalDoctorsManage() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const { id: routeHospitalId } = useParams();
  const navigate = useNavigate();
  const [resolvedHospitalUserId, setResolvedHospitalUserId] = useState(null);
  const isHospital = typeof me?.role === 'string' && me.role.toLowerCase().includes('hospital');
  const amOwner = useMemo(() => isHospital && resolvedHospitalUserId != null && Number(me?.id) === Number(resolvedHospitalUserId), [isHospital, resolvedHospitalUserId, me?.id]);
  const hospitalUserId = resolvedHospitalUserId ?? (isHospital ? me?.id : null);
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ doctor_user_id: '', name: '', specialty: '' });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedDoctorInfo, setSelectedDoctorInfo] = useState(null); // from hospital list (name/specialty/email)
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [schedule, setSchedule] = useState([]);
  const [schedLoading, setSchedLoading] = useState(false);
  const [schedForm, setSchedForm] = useState({ weekday: '', start_time: '', end_time: '', visit_cost: '', max_per_day: '' });
  const [editing, setEditing] = useState({}); // schedule_id -> {visit_cost, max_per_day}
  // Schedules to summarize in the doctors list (per doctor for this hospital)
  const [scheduleByDoctor, setScheduleByDoctor] = useState({}); // doctor_user_id -> [schedule]

  const refresh = async () => {
    if (!hospitalUserId) return;
    setLoading(true); setError(null);
    try { const r = await api.listHospitalDoctors(hospitalUserId); setList(r?.results || []); }
    catch(e){ setError(e.message || 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, [hospitalUserId]);

  // Resolve :id route to owner user_id; if visiting as non-owner, we still show read-only list
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (routeHospitalId) {
        try {
          const h = await api.getHospital(routeHospitalId);
          if (!mounted) return;
          setResolvedHospitalUserId(h?.user_id || Number(routeHospitalId));
        } catch {
          if (mounted) setResolvedHospitalUserId(Number(routeHospitalId));
        }
      } else {
        setResolvedHospitalUserId(isHospital ? me?.id : null);
      }
    })();
    return () => { mounted = false; };
  }, [routeHospitalId, isHospital, me?.id]);
  // Load schedule summaries for each doctor in the list (filtered to this hospital)
  useEffect(() => {
    let cancelled = false;
    if (!list || list.length === 0) { setScheduleByDoctor({}); return; }
    (async () => {
      try {
        const entries = await Promise.all(list.map(async (d) => {
          try {
            const r = await api.listDoctorSchedule(d.user_id);
            const items = (r?.results || []).filter(s => String(s.hospital_user_id) === String(hospitalUserId));
            return [d.user_id, items];
          } catch {
            return [d.user_id, []];
          }
        }));
        if (!cancelled) {
          const map = {};
          for (const [id, items] of entries) map[id] = items;
          setScheduleByDoctor(map);
        }
      } catch {
        if (!cancelled) setScheduleByDoctor({});
      }
    })();
    return () => { cancelled = true; };
  }, [list, hospitalUserId]);

  const add = async (e) => {
    e.preventDefault();
    if (!amOwner) { window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Only hospital owner can manage doctors' } })); return; }
    const id = Number(form.doctor_user_id);
    if (!id) return;
    setBusy(true);
    try {
      // associate doctor to hospital
      await api.addDoctorToHospital(hospitalUserId, id);
  // set required profile data (name/specialty)
  const payload = { doctor_user_id: id, name: form.name.trim(), specialty: form.specialty.trim() };
  if (!payload.name || !payload.specialty) throw new Error('Name and specialty are required');
  await api.setDoctorProfile(id, payload);
      await refresh();
      setForm({ doctor_user_id: '', name: '', specialty: '' });
      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Doctor added' } }));
    } catch(err) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to add doctor' } }));
    } finally { setBusy(false); }
  };
  const remove = async (user_id) => {
    if (!amOwner) { window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Only hospital owner can remove doctors' } })); return; }
    if (!hospitalUserId) return;
    setBusy(true);
    try {
      await api.removeDoctorFromHospital(hospitalUserId, user_id);
      await refresh();
    } catch(err) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to remove doctor' } }));
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const q = search.trim();
    let cancelled = false;
    if (!q) { setResults([]); return; }
    (async () => {
      setSearching(true);
      try { const r = await api.searchUsers(q); if (!cancelled) setResults(r?.results || []); }
      catch { if (!cancelled) setResults([]); }
      finally { if (!cancelled) setSearching(false); }
    })();
    return () => { cancelled = true; };
  }, [search]);

  // When doctor selection changes, auto-fill name and load existing schedule
  useEffect(() => {
    const id = form.doctor_user_id;
    const u = results.find(r => String(r.id) === String(id)) || null;
    setSelectedUser(u || null);
    if (u && !form.name) setForm(v => ({ ...v, name: (u.full_name || u.email || '').trim() }));
    if (id) {
      (async () => {
        setSchedLoading(true);
        try { const r = await api.listDoctorSchedule(id); setSchedule(r?.results || []); }
        catch { setSchedule([]); }
        finally { setSchedLoading(false); }
      })();
    } else {
      setSchedule([]);
    }
  }, [form.doctor_user_id, results]);

  const weekdayLabel = (n) => {
    const map = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    if (n === 0 || n === '0') return 'Sunday';
    const idx = typeof n === 'string' ? parseInt(n, 10) : n;
    return map[idx] ?? String(n);
  };

  return (
    <div className="p-4 bg-white border rounded">
      <h2 className="text-xl font-semibold mb-3">{amOwner ? 'Manage Doctors' : 'Doctors'}</h2>
      {amOwner && (
      <form className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4" onSubmit={add}>
        <label className="text-sm">
          Search Users
          <input className="w-full p-2 bg-gray-100 border rounded" placeholder="Search by name or email" value={search} onChange={e=>setSearch(e.target.value)} />
        </label>
        <label className="text-sm">
          Select User
          <select className="w-full p-2 bg-gray-100 border rounded" value={form.doctor_user_id} onChange={e=>setForm(v=>({...v, doctor_user_id: e.target.value}))}>
            <option value="">-- Select --</option>
            {results.map(u => <option key={u.id} value={u.id}>{u.email}{u.full_name?` (${u.full_name})`:''}</option>)}
          </select>
        </label>
        <label className="text-sm">
          Name
          <input required className="w-full p-2 bg-gray-100 border rounded" value={form.name} onChange={e=>setForm(v=>({...v, name: e.target.value}))} />
        </label>
        <label className="text-sm">
          Specialty
          <input required className="w-full p-2 bg-gray-100 border rounded" value={form.specialty} onChange={e=>setForm(v=>({...v, specialty: e.target.value}))} />
        </label>
        <div className="col-span-full">
          <button type="submit" className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm" disabled={busy}>{busy?'Saving…':'Add Doctor'}</button>
        </div>
      </form>
      )}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      <ul className="divide-y">
        {list.map(d => (
          <li key={d.user_id} className="py-2 text-sm flex items-center justify-between">
            <div>
              <div className="text-gray-800">{d.doctor_name || d.full_name || d.email || `Doctor #${d.user_id}`}{d.specialty?` – ${d.specialty}`:''}</div>
              <div className="text-gray-500">User ID: {d.user_id}</div>
              <div className="text-gray-600 mt-1">
                <span className="font-medium">Role:</span> {d.specialty || '—'} <span className="mx-1">·</span>
                <span className="font-medium">Weekly:</span>{' '}
                {(() => {
                  const items = scheduleByDoctor[d.user_id] || [];
                  if (!items.length) return <span className="text-gray-500">No schedule</span>;
                  const parts = items.map(s => `${weekdayLabel(s.weekday)} ${s.start_time} – ${s.end_time} ($${Number(s.visit_cost ?? 0).toFixed(2)})`);
                  return <span>{parts.join(' | ')}</span>;
                })()}
              </div>
            </div>
            <div>
              {amOwner && (
              <button className="mr-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm" onClick={()=>{
                setForm(v=>({ ...v, doctor_user_id: String(d.user_id), name: d.doctor_name || d.full_name || '', specialty: d.specialty || '' }));
                setSelectedDoctorInfo({ id: d.user_id, name: d.doctor_name || d.full_name || '', specialty: d.specialty || '', email: d.email });
                setPanelCollapsed(false);
              }}>Manage</button>
              )}
              {amOwner && (
              <button className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm" onClick={()=>remove(d.user_id)} disabled={busy}>Remove</button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {amOwner && form.doctor_user_id && (
        <div className="mt-6">
          <div className="flex items-center justify-between bg-gray-100 border rounded px-3 py-2">
            <div className="text-sm">
              <div className="text-gray-900 font-medium">
                {(selectedDoctorInfo?.name || 'Doctor')}{selectedDoctorInfo?.specialty ? ` – ${selectedDoctorInfo.specialty}` : ''}
              </div>
              <div className="text-gray-600">
                User ID: {form.doctor_user_id}
                {selectedDoctorInfo?.email ? <span className="ml-2 text-gray-500">({selectedDoctorInfo.email})</span> : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 bg-gray-300 hover:bg-gray-400 rounded text-sm" onClick={()=>setPanelCollapsed(v=>!v)}>
                {panelCollapsed ? 'Expand' : 'Collapse'}
              </button>
              <button className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm" onClick={()=>{
                // Close the panel: clear selection and state
                setEditing({});
                setSchedule([]);
                setSelectedDoctorInfo(null);
                setSelectedUser(null);
                setPanelCollapsed(false);
                setForm(v=>({ ...v, doctor_user_id: '' }));
              }}>Close</button>
            </div>
          </div>
          {!panelCollapsed && (
            <>
              <h3 className="font-semibold mb-1 mt-3">Weekly Schedule for User #{form.doctor_user_id}</h3>
              {selectedDoctorInfo && (
                <div className="text-sm text-gray-700 mb-2">
                  <span className="font-medium">{selectedDoctorInfo.name || 'Doctor'}</span>
                  {selectedDoctorInfo.specialty ? ` – ${selectedDoctorInfo.specialty}` : ''}
                  {selectedDoctorInfo.email ? <span className="ml-2 text-gray-500">({selectedDoctorInfo.email})</span> : null}
                </div>
              )}
          <form className="grid grid-cols-1 md:grid-cols-5 gap-2 mb-3" onSubmit={async (e)=>{
            e.preventDefault();
            if (!schedForm.weekday || !schedForm.start_time || !schedForm.end_time || !schedForm.visit_cost || !schedForm.max_per_day) return;
            setBusy(true);
            try {
              await api.addDoctorSchedule(
                hospitalUserId,
                Number(form.doctor_user_id),
                Number(schedForm.weekday),
                schedForm.start_time,
                schedForm.end_time,
                Number(schedForm.visit_cost),
                Number(schedForm.max_per_day)
              );
              // reload schedule
              const r = await api.listDoctorSchedule(form.doctor_user_id);
              setSchedule(r?.results || []);
              // update summary list for this doctor
              setScheduleByDoctor(prev => ({ ...prev, [Number(form.doctor_user_id)]: (r?.results || []).filter(s => String(s.hospital_user_id) === String(hospitalUserId)) }));
              setSchedForm({ weekday: '', start_time: '', end_time: '', visit_cost: '', max_per_day: '' });
              window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Schedule added' } }));
            } catch(err) {
              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to add schedule' } }));
            } finally { setBusy(false); }
          }}>
            <label className="text-sm">
              Weekday
              <select className="w-full p-2 bg-gray-100 border rounded" value={schedForm.weekday} onChange={e=>setSchedForm(v=>({...v, weekday: e.target.value}))}>
                <option value="">Select…</option>
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
              </select>
            </label>
            <label className="text-sm">
              Start Time
              <input type="time" className="w-full p-2 bg-gray-100 border rounded" value={schedForm.start_time} onChange={e=>setSchedForm(v=>({...v, start_time: e.target.value}))} />
            </label>
            <label className="text-sm">
              End Time
              <input type="time" className="w-full p-2 bg-gray-100 border rounded" value={schedForm.end_time} onChange={e=>setSchedForm(v=>({...v, end_time: e.target.value}))} />
            </label>
            <label className="text-sm">
              Visit Cost
              <input required type="number" step="0.01" className="w-full p-2 bg-gray-100 border rounded" value={schedForm.visit_cost} onChange={e=>setSchedForm(v=>({...v, visit_cost: e.target.value}))} />
            </label>
            <label className="text-sm">
              Max Patients/Day
              <input required type="number" className="w-full p-2 bg-gray-100 border rounded" value={schedForm.max_per_day} onChange={e=>setSchedForm(v=>({...v, max_per_day: e.target.value}))} />
            </label>
            <div className="col-span-full">
              <button type="submit" className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-sm" disabled={busy}>Add Schedule Block</button>
            </div>
          </form>
          {schedLoading ? (
            <div className="text-sm text-gray-500">Loading schedule…</div>
          ) : (
            <table className="w-full text-sm border">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-2 text-left">Weekday</th>
                  <th className="p-2 text-left">Time</th>
                  <th className="p-2 text-left">Hospital User</th>
                  <th className="p-2 text-left">Visit Cost</th>
                  <th className="p-2 text-left">Max/Day</th>
                  <th className="p-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="p-2">
                      {editing[s.id] ? (
                        <select className="p-1 bg-gray-100 border rounded" value={editing[s.id].weekday}
                          onChange={e=>setEditing(v=>({...v, [s.id]:{...v[s.id], weekday:e.target.value}}))}>
                          <option value="0">Sunday</option>
                          <option value="1">Monday</option>
                          <option value="2">Tuesday</option>
                          <option value="3">Wednesday</option>
                          <option value="4">Thursday</option>
                          <option value="5">Friday</option>
                          <option value="6">Saturday</option>
                        </select>
                      ) : weekdayLabel(s.weekday)}
                    </td>
                    <td className="p-2">
                      {editing[s.id] ? (
                        <div className="flex items-center gap-2">
                          <input type="time" className="p-1 bg-gray-100 border rounded" value={editing[s.id].start_time}
                            onChange={e=>setEditing(v=>({...v, [s.id]:{...v[s.id], start_time:e.target.value}}))} />
                          <span>–</span>
                          <input type="time" className="p-1 bg-gray-100 border rounded" value={editing[s.id].end_time}
                            onChange={e=>setEditing(v=>({...v, [s.id]:{...v[s.id], end_time:e.target.value}}))} />
                        </div>
                      ) : (
                        <>{s.start_time} – {s.end_time}</>
                      )}
                    </td>
                    <td className="p-2">{s.hospital_user_id}</td>
                    <td className="p-2">
                      {editing[s.id] ? (
                        <input type="number" step="0.01" className="p-1 bg-gray-100 border rounded w-24" value={editing[s.id].visit_cost} onChange={e=>setEditing(v=>({...v, [s.id]:{...v[s.id], visit_cost:e.target.value}}))} />
                      ) : (s.visit_cost != null ? `$${Number(s.visit_cost).toFixed(2)}` : '—')}
                    </td>
                    <td className="p-2">
                      {editing[s.id] ? (
                        <input type="number" className="p-1 bg-gray-100 border rounded w-20" value={editing[s.id].max_per_day} onChange={e=>setEditing(v=>({...v, [s.id]:{...v[s.id], max_per_day:e.target.value}}))} />
                      ) : (s.max_per_day ?? '—')}
                    </td>
                    <td className="p-2 space-x-2">
                      {editing[s.id] ? (
                        <>
                          <button className="px-2 py-1 bg-green-600 text-white rounded" onClick={async ()=>{
                            const patch = { };
                            if (editing[s.id].weekday !== undefined) patch.weekday = Number(editing[s.id].weekday);
                            if (editing[s.id].start_time !== undefined) patch.start_time = editing[s.id].start_time;
                            if (editing[s.id].end_time !== undefined) patch.end_time = editing[s.id].end_time;
                            if (editing[s.id].visit_cost !== undefined) patch.visit_cost = Number(editing[s.id].visit_cost);
                            if (editing[s.id].max_per_day !== undefined) patch.max_per_day = Number(editing[s.id].max_per_day);
                            try {
                              await api.updateDoctorSchedule(hospitalUserId, s.id, patch);
                              const r = await api.listDoctorSchedule(form.doctor_user_id);
                              setSchedule(r?.results || []);
                              setScheduleByDoctor(prev => ({ ...prev, [Number(form.doctor_user_id)]: (r?.results || []).filter(s => String(s.hospital_user_id) === String(hospitalUserId)) }));
                              setEditing(v=>{ const nv = {...v}; delete nv[s.id]; return nv; });
                            } catch(err) {
                              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to update schedule' } }));
                            }
                          }}>Save</button>
                          <button className="px-2 py-1 bg-gray-300 rounded" onClick={()=>setEditing(v=>{ const nv={...v}; delete nv[s.id]; return nv; })}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button className="px-2 py-1 bg-blue-600 text-white rounded" onClick={()=>setEditing(v=>({...v, [s.id]:{ weekday: s.weekday, start_time: s.start_time, end_time: s.end_time, visit_cost: s.visit_cost ?? '', max_per_day: s.max_per_day ?? '' }}))}>Edit</button>
                          <button className="px-2 py-1 bg-red-600 text-white rounded" onClick={async ()=>{
                            try {
                              await api.deleteDoctorSchedule(hospitalUserId, s.id);
                              const r = await api.listDoctorSchedule(form.doctor_user_id);
                              setSchedule(r?.results || []);
                              setScheduleByDoctor(prev => ({ ...prev, [Number(form.doctor_user_id)]: (r?.results || []).filter(s => String(s.hospital_user_id) === String(hospitalUserId)) }));
                            } catch(err) {
                              window.dispatchEvent(new CustomEvent('api-error', { detail: { message: err.message || 'Failed to delete schedule' } }));
                            }
                          }}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
                {schedule.length === 0 && (
                  <tr><td colSpan="6" className="p-2 text-gray-500">No schedule yet</td></tr>
                )}
              </tbody>
            </table>
          )}
            </>
          )}
        </div>
      )}
    </div>
  );
}