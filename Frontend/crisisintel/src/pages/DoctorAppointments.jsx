import React, { useEffect, useMemo, useState } from 'react';
import api from '../api';
import { Link } from 'react-router-dom';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import { formatDateTime, fromNow, statusVariant } from '../utils/datetime';

export default function DoctorAppointments() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({}); // id => 'approve'|'decline'|'confirm'|undefined
  useEffect(() => {
    let mounted = true;
    setLoading(true); setError(null);
    api.doctorAppointments()
      .then(res => { if (mounted) setItems(res?.results || []); })
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, []);

  const grouped = useMemo(() => {
    const now = new Date();
    const upcoming = [];
    const past = [];
    for (const a of items) {
      const end = new Date(a.ends_at || a.starts_at);
      if (a.status === 'done' || end < now || a.status === 'cancelled') past.push(a);
      else upcoming.push(a);
    }
    // sort upcoming by starts_at asc, past desc
    upcoming.sort((a,b)=>new Date(a.starts_at)-new Date(b.starts_at));
    past.sort((a,b)=>new Date(b.starts_at)-new Date(a.starts_at));
    return { upcoming, past };
  }, [items]);

  if (loading) return <div className="p-4 bg-white border rounded">Loading…</div>;
  if (error) return <div className="p-4 bg-white border rounded text-red-600">{error}</div>;

  return (
    <div className="p-4 bg-white border rounded">
      <h2 className="text-xl font-semibold mb-3">My Appointments (Doctor)</h2>
      {/* Upcoming section */}
      <div className="mb-6">
        <h3 className="font-semibold mb-2">Upcoming</h3>
        {grouped.upcoming.length === 0 && <div className="text-sm text-gray-600">No upcoming appointments</div>}
        <ul className="divide-y">
          {grouped.upcoming.map(a => (
            <li key={a.id} className="py-3 text-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-2">
                  <div className="font-semibold">{formatDateTime(a.starts_at)} <span className="text-gray-500">({fromNow(a.starts_at)})</span></div>
                  <div className="text-gray-600">
                    <span>Patient {a.patient_name ? a.patient_name : `#${a.patient_user_id}`}</span>
                    {' '}·{' '}
                    <Link className="text-purple-700 hover:underline" to={`/hospitals/${a.hospital_id || a.hospital_user_id}`}>{a.hospital_name || `Hospital #${a.hospital_user_id}`}</Link>
                  </div>
                </div>
                <Badge variant={statusVariant(a.status)}>{a.status.replace('_',' ')}</Badge>
              </div>
              <div className="pt-1 inline-flex items-center gap-2">
                {a.status === 'booked' && (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy[a.id]==='confirm'}
                    onClick={async ()=>{
                      if(!window.confirm('Mark this appointment as done?')) return;
                      setBusy(b => ({ ...b, [a.id]: 'confirm' }));
                      try {
                        await api.confirmAppointment(a.id);
                        setItems(prev => prev.map(x => x.id===a.id ? ({...x, status:'done'}) : x));
                        window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Marked as done' } }));
                      } catch(e) {
                        window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Confirm failed' } }));
                      } finally {
                        setBusy(b => { const n={...b}; delete n[a.id]; return n; });
                      }
                    }}
                  >Confirm Done</Button>
                )}
                {a.status === 'cancel_requested' && (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      loading={busy[a.id]==='approve'}
                      onClick={async ()=>{
                        if(!window.confirm('Approve cancellation for this appointment?')) return;
                        setBusy(b => ({ ...b, [a.id]: 'approve' }));
                        try {
                          await api.approveCancelAppointment(a.id);
                          setItems(prev => prev.map(x => x.id===a.id ? ({...x, status:'cancelled'}) : x));
                          window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Cancellation approved' } }));
                          window.dispatchEvent(new CustomEvent('appointments-changed', { detail: { appointment_id: a.id } }));
                        } catch(e) {
                          window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Approve failed' } }));
                        } finally {
                          setBusy(b => { const n={...b}; delete n[a.id]; return n; });
                        }
                      }}
                    >Approve Cancel</Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={busy[a.id]==='decline'}
                      onClick={async ()=>{
                        if(!window.confirm('Decline the cancellation request?')) return;
                        setBusy(b => ({ ...b, [a.id]: 'decline' }));
                        try {
                          await api.declineCancelAppointment(a.id);
                          setItems(prev => prev.map(x => x.id===a.id ? ({...x, status:'booked'}) : x));
                          window.dispatchEvent(new CustomEvent('toast', { detail: { type:'success', message:'Cancellation declined' } }));
                        } catch(e) {
                          window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Decline failed' } }));
                        } finally {
                          setBusy(b => { const n={...b}; delete n[a.id]; return n; });
                        }
                      }}
                    >Decline</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Past section */}
      <div>
        <h3 className="font-semibold mb-2">Past</h3>
        {grouped.past.length === 0 && <div className="text-sm text-gray-600">No past appointments</div>}
        <ul className="divide-y">
          {grouped.past.map(a => (
            <li key={a.id} className="py-3 text-sm">
              <div className="flex items-start justify-between">
                <div className="flex-1 pr-2">
                  <div className="font-semibold">{formatDateTime(a.starts_at)} <span className="text-gray-500">({fromNow(a.starts_at)})</span></div>
                  <div className="text-gray-600">
                    <span>Patient {a.patient_name ? a.patient_name : `#${a.patient_user_id}`}</span>
                    {' '}·{' '}
                    <Link className="text-purple-700 hover:underline" to={`/hospitals/${a.hospital_id || a.hospital_user_id}`}>{a.hospital_name || `Hospital #${a.hospital_user_id}`}</Link>
                  </div>
                </div>
                <Badge variant={statusVariant(a.status)}>{a.status.replace('_',' ')}</Badge>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
