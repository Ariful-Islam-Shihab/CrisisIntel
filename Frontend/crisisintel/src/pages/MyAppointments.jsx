import React, { useEffect, useState } from 'react';
import api from '../api';
import { Link } from 'react-router-dom';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { formatDateTime, fromNow, statusVariant } from '../utils/datetime';

export default function MyAppointments() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [items, setItems] = useState([]);
  const [invReqs, setInvReqs] = useState([]); // inventory requests I made to banks
  const [donorReqs, setDonorReqs] = useState([]); // donor meeting requests I initiated
  const [hiddenInv, setHiddenInv] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('hidden-inv-reqs') || '[]')); } catch { return new Set(); }
  });
  const [hiddenDMR, setHiddenDMR] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('hidden-dmr-reqs') || '[]')); } catch { return new Set(); }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // id => bool
  useEffect(() => {
    let mounted = true;
    (async ()=>{
      setLoading(true); setError(null);
      try {
        const [apps, inv, donor] = await Promise.all([
          api.myAppointments().catch(e=>{ throw e; }),
          api.listInventoryRequests({ requester_user_id: me?.id }).catch(()=>({ results: [] })),
          api.listDonorMeetingRequests({ requester_user_id: me?.id }).catch(()=>({ results: [] })),
        ]);
        if (!mounted) return;
        setItems(apps?.results || []);
  setInvReqs((inv?.results || inv?.items || []).filter(r => !hiddenInv.has(r.id)));
  setDonorReqs((donor?.results || donor?.items || []).filter(r => !hiddenDMR.has(r.id)));
      } catch (e) {
        if (mounted) setError(e.message || 'Failed to load');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (loading) return <div className="p-4 bg-white border rounded">Loading…</div>;
  if (error) return <div className="p-4 bg-white border rounded text-red-600">{error}</div>;

  return (
    <div className="p-4 bg-white border rounded space-y-8">
      <h2 className="text-xl font-semibold">My Appointments</h2>
      {items.length === 0 && <div className="text-sm text-gray-600">No appointments yet</div>}
      <ul className="divide-y">
        {items.map(a => {
          const start = new Date(a.starts_at);
          const canCancel = a.status === 'booked' && (start - new Date()) > 2*60*60*1000;
          const isPast = (new Date(a.ends_at || a.starts_at)) < new Date();
          const canDelete = isPast || a.status !== 'booked';
          return (
            <li key={a.id} className="py-3 text-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-2">
                  <div className="font-semibold">{formatDateTime(a.starts_at)} <span className="text-gray-500">({fromNow(a.starts_at)})</span></div>
                  <div className="text-gray-600">
                    <Link className="text-purple-700 hover:underline" to={`/doctors/${a.doctor_id || a.doctor_user_id}`}>{a.doctor_name || `Doctor #${a.doctor_user_id}`}</Link>
                    {' '}·{' '}
                    <Link className="text-purple-700 hover:underline" to={`/hospitals/${a.hospital_id || a.hospital_user_id}`}>{a.hospital_name || `Hospital #${a.hospital_user_id}`}</Link>
                  </div>
                  {(a.serial != null || a.approx_time) && (
                    <div className="text-gray-700">{a.serial != null ? `Token #${a.serial}` : ''}{a.serial != null && a.approx_time ? ' · ' : ''}{a.approx_time ? `Approx: ${a.approx_time}` : ''}</div>
                  )}
                </div>
                <Badge variant={statusVariant(a.status)}>{a.status.replace('_',' ')}</Badge>
              </div>
              <div className="mt-1 inline-flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    try {
                      const dtStart = new Date(a.starts_at);
                      const dtEnd = new Date(a.ends_at || a.starts_at);
                      const pad = n => String(n).padStart(2,'0');
                      const fmt = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
                      const docName = a.doctor_name || `Doctor #${a.doctor_user_id}`;
                      const hospName = a.hospital_name || `Hospital #${a.hospital_user_id}`;
                      const ics = [
                        'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CrisisIntel//Appointments//EN','BEGIN:VEVENT',
                        `DTSTART:${fmt(dtStart)}`,
                        `DTEND:${fmt(dtEnd)}`,
                        `SUMMARY:Appointment with ${docName}`,
                        `DESCRIPTION:${hospName}${a.serial!=null?`\\nToken #${a.serial}`:''}${a.approx_time?`\\nApprox ${a.approx_time}`:''}`,
                        'END:VEVENT','END:VCALENDAR'
                      ].join('\r\n');
                      const blob = new Blob([ics], { type: 'text/calendar' });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url; link.download = 'appointment.ics'; link.click();
                      URL.revokeObjectURL(url);
                    } catch {
                      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Could not create calendar file' } }));
                    }
                  }}
                >Add to calendar</Button>
                {canCancel && (
                  <Button
                    size="sm"
                    variant="outline"
                    loading={!!busy[a.id]}
                    onClick={async ()=>{
                      if (!window.confirm('Request to cancel this appointment? The doctor must approve.')) return;
                      setBusy(b => ({ ...b, [a.id]: true }));
                      try {
                        await api.cancelAppointment(a.id);
                        window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Cancel requested' } }));
                        setItems(prev => prev.map(x => x.id === a.id ? ({ ...x, status: 'cancel_requested' }) : x));
                        window.dispatchEvent(new CustomEvent('appointments-changed', { detail: { appointment_id: a.id } }));
                      } catch (e) {
                        const msg = String(e.message||'').toLowerCase();
                        let friendly = null;
                        if (msg.includes('too_late_to_cancel')) friendly = 'Too late to cancel (within 2 hours).';
                        else if (msg.includes('invalid_status')) friendly = 'This appointment cannot be cancelled now.';
                        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: friendly || (e.message || 'Cancel failed') } }));
                      } finally {
                        setBusy(b => { const n={...b}; delete n[a.id]; return n; });
                      }
                    }}
                  >Request cancel</Button>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="danger"
                    loading={!!busy[`del-${a.id}`]}
                    onClick={async ()=>{
                      if (!window.confirm('Hide this appointment from your list?')) return;
                      setBusy(b => ({ ...b, [`del-${a.id}`]: true }));
                      try {
                        await api.hideAppointment(a.id);
                        setItems(prev => prev.filter(x => x.id !== a.id));
                        window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Removed' } }));
                        window.dispatchEvent(new CustomEvent('appointments-changed', { detail: { appointment_id: a.id } }));
                      } catch (e) {
                        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to remove' } }));
                      } finally {
                        setBusy(b => { const n={...b}; delete n[`del-${a.id}`]; return n; });
                      }
                    }}
                  >Delete</Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {/* My Blood Requests to Banks */}
      <div>
        <h3 className="text-lg font-semibold mb-2">My Blood Requests (to Banks)</h3>
        {invReqs.length === 0 && <div className="text-sm text-gray-600">No blood requests yet</div>}
        <ul className="divide-y">
          {invReqs.map(r => (
            <li key={`inv-${r.id}`} className="py-3 text-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-2">
                  <div className="font-semibold">{r.blood_type} · {r.quantity_units} unit(s)</div>
                  <div className="text-gray-600">Target: {r.target_datetime ? formatDateTime(r.target_datetime) : '—'} <span className="text-gray-500">{r.target_datetime ? `(${fromNow(r.target_datetime)})` : ''}</span></div>
                  {r.location_text && <div className="text-gray-700">Location: {r.location_text}</div>}
                  {r.notes && <div className="text-gray-700">Notes: {r.notes}</div>}
                </div>
                <Badge variant={statusVariant(r.status)}>{r.status.replace('_',' ')}</Badge>
              </div>
              <div className="mt-1 inline-flex items-center gap-2">
                {['pending','accepted'].includes(r.status) && (
                  <Button size="sm" variant="outline" loading={!!busy[`inv-${r.id}`]} onClick={async()=>{
                    if (!window.confirm('Cancel this request? Allowed until 2 hours before target time.')) return;
                    setBusy(b=>({...b, [`inv-${r.id}`]: true}));
                    try {
                      await api.updateInventoryRequestStatus(r.id, 'cancelled');
                      setInvReqs(x => x.map(y => y.id === r.id ? ({...y, status:'cancelled'}) : y));
                      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Request cancelled' } }));
                    } catch (e) {
                      const msg = String(e.message||'').toLowerCase();
                      let friendly = null;
                      if (msg.includes('too_late_to_cancel')) friendly = 'Too late to cancel (within 2 hours).';
                      else if (msg.includes('immutable')) friendly = 'This request can no longer be changed.';
                      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: friendly || (e.message || 'Cancel failed') } }));
                    } finally {
                      setBusy(b=>{ const n={...b}; delete n[`inv-${r.id}`]; return n; });
                    }
                  }}>Cancel</Button>
                )}
                {['cancelled','completed'].includes(r.status) && (
                  <Button size="sm" variant="danger" onClick={()=>{
                    try {
                      const next = new Set(Array.from(hiddenInv)); next.add(r.id);
                      setHiddenInv(next);
                      localStorage.setItem('hidden-inv-reqs', JSON.stringify(Array.from(next)));
                      setInvReqs(list => list.filter(x => x.id !== r.id));
                      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Removed from list' } }));
                    } catch {}
                  }}>Delete</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Donor Meeting Requests I initiated */}
      <div>
        <h3 className="text-lg font-semibold mb-2">My Donor Meeting Requests</h3>
        {donorReqs.length === 0 && <div className="text-sm text-gray-600">No donor meeting requests yet</div>}
        <ul className="divide-y">
          {donorReqs.map(r => (
            <li key={`dmr-${r.id}`} className="py-3 text-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-2">
                  <div className="font-semibold">{r.blood_type || '—'} {r.blood_type ? ' · ' : ''}{r.location_text || ''}</div>
                  <div className="text-gray-600">When: {r.target_datetime ? formatDateTime(r.target_datetime) : '—'} <span className="text-gray-500">{r.target_datetime ? `(${fromNow(r.target_datetime)})` : ''}</span></div>
                  {r.location_text && <div className="text-gray-700">Location: {r.location_text}</div>}
                  {r.notes && <div className="text-gray-700">Notes: {r.notes}</div>}
                </div>
                <Badge variant={statusVariant(r.status)}>{r.status.replace('_',' ')}</Badge>
              </div>
              <div className="mt-1 inline-flex items-center gap-2">
                {['pending','accepted'].includes(r.status) && (
                  <Button size="sm" variant="outline" loading={!!busy[`dmr-${r.id}`]} onClick={async()=>{
                    if (!window.confirm('Cancel this donor meeting request? Allowed until 2 hours before.')) return;
                    setBusy(b=>({...b, [`dmr-${r.id}`]: true}));
                    try {
                      await api.updateDonorMeetingRequestStatus(r.id, 'cancelled');
                      setDonorReqs(x => x.map(y => y.id === r.id ? ({...y, status:'cancelled'}) : y));
                      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Request cancelled' } }));
                    } catch (e) {
                      const msg = String(e.message||'').toLowerCase();
                      let friendly = null;
                      if (msg.includes('too_late_to_cancel')) friendly = 'Too late to cancel (within 2 hours).';
                      else if (msg.includes('immutable')) friendly = 'This request can no longer be changed.';
                      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: friendly || (e.message || 'Cancel failed') } }));
                    } finally {
                      setBusy(b=>{ const n={...b}; delete n[`dmr-${r.id}`]; return n; });
                    }
                  }}>Cancel</Button>
                )}
                {['cancelled','completed'].includes(r.status) && (
                  <Button size="sm" variant="danger" onClick={()=>{
                    try {
                      const next = new Set(Array.from(hiddenDMR)); next.add(r.id);
                      setHiddenDMR(next);
                      localStorage.setItem('hidden-dmr-reqs', JSON.stringify(Array.from(next)));
                      setDonorReqs(list => list.filter(x => x.id !== r.id));
                      window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message: 'Removed from list' } }));
                    } catch {}
                  }}>Delete</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
