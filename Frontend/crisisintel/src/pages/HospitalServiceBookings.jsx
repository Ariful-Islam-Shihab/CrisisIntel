import React, { useEffect, useState, useCallback } from 'react';
import api from '../api';
import Badge from '../components/ui/Badge';

export default function HospitalServiceBookings() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const isHospital = typeof me?.role === 'string' && me.role.toLowerCase().includes('hospital');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all'); // all|booked|confirmed|declined|cancel_requested|cancelled
  const [serviceFilter, setServiceFilter] = useState('all'); // 'all' or service_id
  const [services, setServices] = useState([]);

  const load = useCallback(async () => {
    if (!isHospital) return;
    setLoading(true); setError(null);
    try {
      // Load bookings and services in parallel for the filter dropdown
      const [bookingsResp, servicesResp] = await Promise.all([
        api.hospitalServiceBookings(),
        // Use hospital user id from current user to get owned services list
        api.request(`/hospitals/${me?.id}/services/list`).catch(() => ({ results: [] }))
      ]);
      setItems(bookingsResp.results || bookingsResp.items || []);
      setServices(servicesResp?.results || []);
    } catch(e) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [isHospital, me?.id]);

  useEffect(() => { load(); }, [load]);

  const view = items
    .filter(it => (filter==='all' ? true : it.status === filter))
    .filter(it => (serviceFilter==='all' ? true : String(it.service_id) === String(serviceFilter)));

  return (
    <div className="p-4 bg-white border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl">Service Appointments</h2>
        <div className="flex items-center gap-2">
          <select className="p-1 bg-gray-100 border rounded text-sm" value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)}>
            <option value="all">All services</option>
            {(services && services.length ? services : Array.from(new Map(items.map(x => [x.service_id, { id: x.service_id, name: x.service_name || `Service #${x.service_id}` }])).values()))
              .map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
          </select>
          <select className="p-1 bg-gray-100 border rounded text-sm" value={filter} onChange={e=>setFilter(e.target.value)}>
            <option value="all">All</option>
            <option value="booked">Booked</option>
            <option value="confirmed">Confirmed</option>
            <option value="declined">Declined</option>
            <option value="cancel_requested">Cancel requested</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded" onClick={load} disabled={loading}>{loading?'...':'Refresh'}</button>
        </div>
      </div>
      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {!loading && view.length === 0 && (
        <div className="text-sm text-gray-500">No appointments.</div>
      )}
      <ul className="divide-y">
        {view.map(b => (
          <li key={b.id} className="py-3 flex items-start justify-between">
            <div className="flex-1 pr-4">
              <div className="text-sm font-semibold">{new Date(b.scheduled_at).toLocaleString()}</div>
              <div className="text-sm">
                <span className="font-medium">{b.service_name || `Service #${b.service_id}`}</span>
                {b.service_duration_minutes != null && <span> · {b.service_duration_minutes} min</span>}
              </div>
              {(b.notes || (b.lat!=null && b.lng!=null)) && (
                <div className="text-[13px] text-gray-700 whitespace-pre-wrap">
                  {b.notes ? <div>Notes: {b.notes}</div> : null}
                  {(b.lat!=null && b.lng!=null) ? <div>Location: {Number(b.lat).toFixed(6)}, {Number(b.lng).toFixed(6)}</div> : null}
                </div>
              )}
              <div className="text-[13px] text-gray-700">
                Patient: <span className="font-medium">{b.user_name || `User #${b.user_id}`}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={b.status==='booked'?'green':(b.status==='cancel_requested'?'orange':'gray')}>{String(b.status).replace('_',' ')}</Badge>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
