import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

function TypeBadge({ type }) {
  const map = {
    post_comment: 'bg-blue-100 text-blue-800',
    post_shared: 'bg-purple-100 text-purple-800',
    user_followed: 'bg-amber-100 text-amber-800',
    fire_request_candidate: 'bg-red-100 text-red-800',
    fire_request_assigned: 'bg-red-100 text-red-800',
    fire_team_deployed: 'bg-red-100 text-red-800',
    message_new: 'bg-gray-100 text-gray-800',
    appointment_booked: 'bg-green-100 text-green-800',
    incident_created: 'bg-indigo-100 text-indigo-800',
    incident_status: 'bg-indigo-100 text-indigo-800',
    donor_applied: 'bg-red-100 text-red-800',
    application_status: 'bg-red-100 text-red-800',
    inventory_request_created: 'bg-red-100 text-red-800',
    inventory_request_accepted: 'bg-green-100 text-green-800',
    inventory_request_rejected: 'bg-amber-100 text-amber-800',
    inventory_request_cancelled: 'bg-gray-100 text-gray-800',
    inventory_request_completed: 'bg-green-100 text-green-800',
    donor_meeting_request_created: 'bg-red-100 text-red-800',
    donor_meeting_request_accepted: 'bg-green-100 text-green-800',
    donor_meeting_request_rejected: 'bg-amber-100 text-amber-800',
    donor_meeting_request_cancelled: 'bg-gray-100 text-gray-800',
    donor_meeting_request_completed: 'bg-green-100 text-green-800',
    campaign_donation: 'bg-amber-100 text-amber-800',
    campaign_participated: 'bg-emerald-100 text-emerald-800',
    potential_victim_detected: 'bg-amber-100 text-amber-800',
  };
  const cls = map[type] || 'bg-gray-100 text-gray-800';
  return <span className={`px-2 py-0.5 rounded text-[11px] ${cls}`}>{type}</span>;
}

function Row({ n, onRead }) {
  const created = n.created_at ? new Date(n.created_at).toLocaleString() : '';
  const read = n.is_read ? 'text-gray-400' : 'text-gray-900 font-medium';
  const payload = n.payload || {};
  let text = '';
  let to = null;
  switch (n.type) {
    case 'post_comment':
      text = `Someone commented on your post #${payload.post_id}`;
      to = payload.post_id ? `/posts/${payload.post_id}${payload.comment_id ? `?highlight_comment=${payload.comment_id}` : ''}` : null;
      break;
    case 'post_shared':
      text = `Your post #${payload.post_id} was shared`;
      to = payload.post_id ? `/posts/${payload.post_id}` : null;
      break;
    case 'user_followed':
      text = 'You have a new follower';
      to = payload.follower_user_id ? `/users/${payload.follower_user_id}` : null;
      break;
    case 'message_new':
      text = 'New message received';
      to = payload.conversation_id ? `/inbox` : '/inbox';
      break;
    case 'fire_request_candidate':
      text = `New fire request #${payload.request_id} for your department`;
      to = payload.request_id ? `/fire/requests/${payload.request_id}` : null;
      break;
    case 'fire_request_assigned':
      text = `Your request #${payload.request_id} was assigned`;
      to = payload.request_id ? `/fire/requests/${payload.request_id}` : null;
      break;
    case 'fire_team_deployed':
      text = `You were deployed to fire request #${payload.request_id}`;
      to = payload.request_id ? `/fire/requests/${payload.request_id}` : null;
      break;
    case 'appointment_booked': {
      const who = payload.patient_name || `Patient #${payload.patient_id}`;
      const when = payload.starts_at ? new Date(payload.starts_at).toLocaleString() : '';
      const hosp = payload.hospital_name || (payload.hospital_user_id ? `Hospital #${payload.hospital_user_id}` : '');
      const approx = payload.approx_time ? ` (~${payload.approx_time})` : '';
      text = `${who} booked ${when}${approx}${hosp ? ` · ${hosp}` : ''}`;
      to = '/appointments/doctor';
      break;
    }
    case 'appointment_cancel_requested': {
      const who = payload.patient_name || `Patient #${payload.by_patient_id}`;
      const when = payload.starts_at ? new Date(payload.starts_at).toLocaleString() : '';
      const hosp = payload.hospital_name || (payload.hospital_user_id ? `Hospital #${payload.hospital_user_id}` : '');
      text = `${who} requested to cancel ${when}${hosp ? ` · ${hosp}` : ''}`;
      to = '/appointments/doctor';
      break;
    }
    case 'incident_created':
      text = `Incident #${payload.incident_id} created`;
      to = payload.incident_id ? `/incidents/${payload.incident_id}` : null;
      break;
    case 'incident_status':
      text = `Incident #${payload.incident_id} status: ${payload.status}`;
      to = payload.incident_id ? `/incidents/${payload.incident_id}` : null;
      break;
    case 'donor_applied':
      text = `New donor application on your recruit post #${payload.post_id}`;
      to = payload.post_id ? `/blood-bank/recruit` : null;
      break;
    case 'application_status':
      text = `Your donation application was ${payload.status}`;
      to = '/recruit';
      break;
    case 'inventory_request_created':
      text = `New bank inventory request #${payload.request_id}`;
  to = payload.crisis_id ? `/crises/${payload.crisis_id}#requests` : '/blood-bank/requests';
      break;
    case 'inventory_request_accepted':
      text = `Your bank inventory request #${payload.request_id} was accepted`;
  to = payload.crisis_id ? `/crises/${payload.crisis_id}#requests` : '/notifications';
      break;
    case 'inventory_request_rejected':
      text = `Your bank inventory request #${payload.request_id} was rejected (${payload.reason || 'reason provided'})`;
  to = payload.crisis_id ? `/crises/${payload.crisis_id}#requests` : '/notifications';
      break;
    case 'inventory_request_cancelled':
      text = `A bank inventory request #${payload.request_id} was cancelled`;
  to = payload.crisis_id ? `/crises/${payload.crisis_id}#requests` : '/notifications';
      break;
    case 'inventory_request_completed':
      text = `Your bank inventory request #${payload.request_id} was completed`;
  to = payload.crisis_id ? `/crises/${payload.crisis_id}#requests` : '/notifications';
      break;
    case 'donor_meeting_request_created':
      text = `New donor meeting request #${payload.request_id}`;
  to = payload.crisis_id ? `/crises/${payload.crisis_id}#requests` : '/donor/requests';
      break;
    case 'donor_meeting_request_accepted':
      text = `Your donor meeting request #${payload.request_id} was accepted`;
  to = payload.crisis_id ? `/crises/${payload.crisis_id}#requests` : '/donor/requests';
      break;
    case 'donor_meeting_request_rejected':
      text = `Your donor meeting request #${payload.request_id} was rejected`;
  to = payload.crisis_id ? `/crises/${payload.crisis_id}#requests` : '/donor/requests';
      break;
    case 'donor_meeting_request_cancelled':
      text = `A donor meeting request #${payload.request_id} was cancelled`;
  to = payload.crisis_id ? `/crises/${payload.crisis_id}#requests` : '/donor/requests';
      break;
    case 'donor_meeting_request_completed':
      text = `Donor meeting request #${payload.request_id} was marked completed`;
      to = payload.crisis_id ? `/crises/${payload.crisis_id}` : '/donor/requests';
      break;
    case 'campaign_donation': {
      const who = payload.donor_name || (payload.donor_user_id ? `User #${payload.donor_user_id}` : 'Someone');
      const amt = payload.amount != null ? `${payload.amount} ${payload.currency || 'BDT'}` : '';
      const title = payload.campaign_title || `Campaign #${payload.campaign_id}`;
      text = `${who} donated ${amt} to ${title}`;
      to = payload.campaign_id ? `/campaigns/${payload.campaign_id}` : null;
      break;
    }
    case 'campaign_participated': {
      const who = payload.participant_name || (payload.participant_user_id ? `User #${payload.participant_user_id}` : 'Someone');
      const title = payload.campaign_title || `Campaign #${payload.campaign_id}`;
      text = `${who} ${payload.rejoined ? 'rejoined' : 'joined'} ${title}`;
      to = payload.campaign_id ? `/campaigns/${payload.campaign_id}` : null;
      break;
    }
    case 'potential_victim_detected': {
      const dist = payload.distance_km != null ? ` (${payload.distance_km} km)` : '';
      text = `You're inside a crisis radius${dist}. Tap to request help.`;
      to = payload.crisis_id ? `/crises/${payload.crisis_id}` : null;
      break;
    }
    default:
      text = n.type;
  }
  const content = (
    <div className="flex items-center space-x-2">
      <TypeBadge type={n.type} />
      <div className={`text-sm ${read}`}>{text}</div>
    </div>
  );
  return (
    <li className={`p-3 bg-white border border-gray-200 rounded flex items-center justify-between ${n.is_read ? '' : 'shadow-sm'}`}>
      {to ? <Link to={to} className="flex-1 hover:underline">{content}</Link> : content}
      <div className="flex items-center space-x-3 text-xs text-gray-500 ml-3">
        <span>{created}</span>
        {!n.is_read && <button className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded" onClick={() => onRead(n.id)}>Mark read</button>}
      </div>
    </li>
  );
}

export default function Notifications() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await api.listNotifications({ page_size: 50 });
      setItems(res.results || res.items || []);
    } catch (e) {
      setError(e.message || 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function markRead(id) {
    try { await api.markNotificationRead(id); await load(); } catch {}
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <div className="flex items-center space-x-2">
          <button className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-sm" onClick={load}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm" onClick={async () => { try { await api.markAllNotificationsRead(); await load(); } catch {} }}>
            Mark all read
          </button>
        </div>
      </div>
      {error && <div className="text-red-600 text-sm">{error}</div>}
      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      <ul className="space-y-2">
        {items.map(n => <Row key={n.id} n={n} onRead={markRead} />)}
      </ul>
      {!loading && items.length === 0 && <div className="text-sm text-gray-500">No notifications.</div>}
    </div>
  );
}
