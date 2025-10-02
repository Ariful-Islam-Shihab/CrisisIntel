/**
 * Centralized API client for backend endpoints (raw SQL Django service).
 *
 * Responsibilities:
 *  - Attach auth + CSRF headers stored in localStorage (X-Auth-Token / X-CSRF-Token)
 *  - Standardize JSON parsing + error surface (dispatches browser CustomEvents)
 *  - Provide small wrapper methods per endpoint for clarity + discoverability
 *
 * Error Handling:
 *  - On 401 responses a 'api-auth-required' event is fired so UI can redirect.
 *  - All non-OK responses emit 'api-error' with a human-friendly message.
 *
 * Uploads:
 *  - `uploadImage` uses FormData (no explicit Content-Type so browser sets boundary).
 *
 * NOTE: Keep functions thin—complex client logic lives in components (e.g. Feed).
 */
const API_BASE = '/api';

/** Read auth + CSRF tokens from localStorage (null if absent). */
function getAuth() {
  return {
    token: localStorage.getItem('authToken') || null,
    csrf: localStorage.getItem('csrfToken') || null,
  };
}

/**
 * Generic JSON request helper.
 * Serializes body (if provided), attaches auth headers, parses JSON response.
 * Emits browser events for global toast handling / auth redirect.
 *
 * opts:
 *  - silent: when true, suppress dispatching 'api-error' toast entirely
 *  - suppressStatus: number[] HTTP status codes that should not emit error toast
 *  - suppressCodes: string[] backend error codes (data.error) that should not emit error toast
 */
async function request(path, method = 'GET', body, opts = {}) {
  const { silent = false, suppressStatus = [], suppressCodes = [] } = opts;
  const headers = { 'Content-Type': 'application/json' };
  const { token, csrf } = getAuth();
  if (token) headers['X-Auth-Token'] = token;
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
  } catch (netErr) {
    console.error('[API] network error', { path, method, netErr });
    throw new Error('Network error contacting API');
  }
  let data = {};
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    // non-JSON response
    data = { raw: text };
  }
  if (!res.ok) {
    // Map known error codes to friendly messages
    const mapFriendly = (d) => {
      const code = (d && typeof d.error === 'string') ? d.error : null;
      if (!code) return d.detail || d.message || `API ${res.status}`;
      switch (code) {
        case 'one_per_day':
          return "You've already booked this service today.";
        case 'outside_window': {
          const ws = d.window_start || 'start'; const we = d.window_end || 'end';
          return `Please choose a time between ${ws} and ${we}.`;
        }
        case 'full':
          return 'No slots available for the selected date.';
        case 'service_unavailable':
          return 'This service is currently unavailable.';
        case 'service_not_found':
          return 'Service not found.';
        case 'missing_fields':
          return 'Please complete all required fields.';
        case 'forbidden':
          return "You don't have permission to perform this action.";
        case 'not_doctor':
          return 'Doctor access only.';
        default:
          return d.detail || d.message || code;
      }
    };
    let msg = mapFriendly(data);
    if (msg && typeof msg === 'object') {
      try { msg = JSON.stringify(msg); } catch { msg = 'API error'; }
    }
    const code = (data && typeof data.error === 'string') ? data.error : null;
    const shouldSuppress = silent || suppressStatus.includes(res.status) || (code && suppressCodes.includes(code));
    if (res.status === 401) window.dispatchEvent(new CustomEvent('api-auth-required', { detail: { status: 401 } }));
    if (!shouldSuppress) window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
    console.warn('[API] error response', { path, method, status: res.status, data });
    throw new Error(msg);
  }
  console.debug('[API] success', { path, method, data });
  return data;
}

// Simple in-memory cache for hot lookups
const _hotCache = {
  hospitalByUser: new Map(), // key: user_id (string) -> { ts: number, data?: any, promise?: Promise<any> }
};
const HOSP_BY_USER_TTL_MS = 10 * 60 * 1000; // 10 minutes

const api = {
  /** Low-level JSON request helper (exposed for convenience). */
  request: (path, method = 'GET', body, opts) => request(path, method, body, opts),
  /** Register a new user. form: { email, password, full_name?, role? } */
  register: (form) => request('/register/', 'POST', form),
  /** Login and persist tokens + user profile to localStorage. */
  login: async (form) => {
    const data = await request('/login/', 'POST', form);
    if (data?.token) localStorage.setItem('authToken', data.token);
    if (data?.csrf_token) localStorage.setItem('csrfToken', data.csrf_token);
    if (data?.user) localStorage.setItem('me', JSON.stringify(data.user));
    return data;
  },
  /** Fetch unified feed (posts + shares). */
  newsFeed: () => request('/news_feed/'),
  /** Create new post with optional image URL. */
  createPost: (body, image_url) => request('/posts/', 'POST', { body, image_url }),
  /** Update existing post by id. */
  updatePost: (post_id, body, image_url) => request(`/posts/${post_id}/`, 'PUT', { body, image_url }),
  /** Delete post by id. */
  deletePost: (post_id) => request(`/posts/${post_id}/`, 'DELETE'),
  /** Share existing post with optional comment. */
  sharePost: (post_id, comment) => request(`/posts/${post_id}/share/`, 'POST', { comment }),
  /** Update share comment. */
  updateShare: (share_id, comment) => request(`/shares/${share_id}/`, 'PUT', { comment }),
  /** Delete share. */
  deleteShare: (share_id) => request(`/shares/${share_id}/`, 'DELETE'),
  /** Add comment to post. */
  addComment: (post_id, body) => request(`/posts/${post_id}/comments/`, 'POST', { body }),
  /** Update comment body. */
  updateComment: (comment_id, body) => request(`/comments/${comment_id}/`, 'PUT', { body }),
  /** Delete comment. */
  deleteComment: (comment_id) => request(`/comments/${comment_id}/`, 'DELETE'),
  /** List comments for a post. */
  comments: (post_id) => request(`/posts/${post_id}/comments/list/`),
  /** List shares for a post. */
  sharesOf: (post_id) => request(`/posts/${post_id}/shares/`),
  /** Text search across posts, doctors, hospitals. */
  search: (q) => request(`/search/?q=${encodeURIComponent(q)}`),
  /** Stats (counts) for current user. */
  myStats: () => request('/my_stats/'),
  /** List fire service requests (optional status filter e.g. 'pending'). */
  fireRequests: (status) => request(`/fire/requests${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  /** List fire service requests with all=1 (for admin/service browse views). */
  fireRequestsAll: (status) => request(`/fire/requests?all=1${status ? `&status=${encodeURIComponent(status)}` : ''}`),
  /** List only my (requester) fire service requests */
  myFireRequests: () => request('/fire/requests?mine=1'),
  /** Create a new fire service request (regular/auth user). */
  createFireRequest: (description, lat, lng) => {
    const body = { description };
    if (lat !== undefined && lat !== null && lat !== '') body.lat = lat;
    if (lng !== undefined && lng !== null && lng !== '') body.lng = lng;
    return request('/fire/requests', 'POST', body);
  },
  /** List fire departments (owner will filter on client). */
  listFireDepartments: () => request('/fire/departments/list'),
  /** Update fire department (owner or admin). */
  updateFireDepartment: (department_id, patch) => request(`/fire/departments/${department_id}/update`, 'POST', patch),
  /** Deploy a fire team to a request. */
  deployFireRequestTeam: (request_id, team_id) => request(`/fire/requests/${request_id}/deploy/team`, 'POST', { team_id }),
  /** Mark a deployed fire request as completed. */
  completeFireRequest: (request_id) => request(`/fire/requests/${request_id}/complete`, 'POST'),
  /** Cancel my own pending unassigned fire request. */
  cancelFireRequest: (request_id) => request(`/fire/requests/${request_id}/cancel`, 'POST'),
  /** Hide a fire request from my view (soft delete). */
  hideFireRequest: (request_id) => request(`/fire/requests/${request_id}/hide`, 'POST'),
  /** Fetch current + past deployment activities for fire service user. */
  fireActivities: () => request('/fire/activities'),
  crisesNearby: (params = {}) => {
    const u = new URLSearchParams(params);
    const qs = u.toString();
    return request(`/crises/nearby${qs ? ('?' + qs) : ''}`);
  },
  /** List teams for a department (public-safe). */
  listFireTeams: (department_id) => request(`/fire/departments/${department_id}/teams/list`),
  /** Public: list staff for a department. */
  listFireStaff: (department_id) => request(`/fire/departments/${department_id}/staff/list`),
  /** Create a fire request targeting a specific department id. */
  createFireRequestToDepartment: (department_id, description, lat, lng) => {
    const body = { description, target_department_id: department_id };
    if (lat !== undefined && lat !== null && lat !== '') body.lat = lat;
    if (lng !== undefined && lng !== null && lng !== '') body.lng = lng;
    return request('/fire/requests', 'POST', body);
  },
  /** Upload binary image file; returns { url }. */
  uploadImage: async (file) => {
    const form = new FormData();
    form.append('file', file);
    const headers = {};
    const { token, csrf } = getAuth();
    if (token) headers['X-Auth-Token'] = token;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(API_BASE + '/upload_image/', {
      method: 'POST',
      headers,
      body: form,
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },
  /** Get a single post by id (public). */
  getPost: (post_id) => request(`/posts/${post_id}/`),
  /** Get public user profile by id. */
  getUserPublic: (user_id) => request(`/users/${user_id}`),
  /** Update current user profile (bio, avatar_url). */
  updateCurrentUser: (patch) => request('/users/me/update', 'POST', patch),
  /** Follow a user (requires auth). */
  followUser: (user_id) => request(`/users/${user_id}/follow`, 'POST', {}),
  /** Unfollow a user (requires auth). */
  unfollowUser: (user_id) => request(`/users/${user_id}/unfollow`, 'POST', {}),
  /** List recent posts authored by a user. */
  getUserPosts: (user_id, limit=20) => request(`/users/${user_id}/posts?limit=${encodeURIComponent(limit)}`),
  /** List combined activity (posts + shares) for a user. */
  getUserActivity: (user_id) => request(`/users/${user_id}/activity`),
  /** List organizations a user is involved with. */
  getUserOrganizations: (user_id) => request(`/users/${user_id}/organizations`),
  /** Get doctor by id. */
  getDoctor: (doctor_id) => request(`/doctors/${doctor_id}`),
  /** Get hospital by canonical id with fallback to by-user when the param is actually a user id. */
  getHospital: async (hospital_id_or_user_id) => {
    const idStr = String(hospital_id_or_user_id ?? '');
    // Try canonical id first
    try {
      return await request(`/hospitals/${encodeURIComponent(idStr)}`);
    } catch (e) {
      // If not found, try resolving by user id (legacy links)
      try { return await api.getHospitalByUser(idStr); } catch (_) { throw e; }
    }
  },
  /** Get hospital by owning user id (cached, in-flight de-duped). */
  getHospitalByUser: (user_id, opts={}) => {
    const key = String(user_id ?? '');
    const now = Date.now();
    const force = opts && opts.force;
    let entry = _hotCache.hospitalByUser.get(key);
    if (!force && entry) {
      // Serve from cache if fresh
      if (entry.data && (now - entry.ts) < HOSP_BY_USER_TTL_MS) {
        return Promise.resolve(entry.data);
      }
      // Reuse in-flight request if any
      if (entry.promise) return entry.promise;
    }
    // Start new request
    const p = request(`/hospitals/by-user/${user_id}`)
      .then((res) => {
        _hotCache.hospitalByUser.set(key, { ts: Date.now(), data: res });
        return res;
      })
      .catch((err) => {
        // Drop failed cache entry to allow retry next time
        _hotCache.hospitalByUser.delete(key);
        throw err;
      });
    _hotCache.hospitalByUser.set(key, { ts: now, promise: p });
    return p;
  },
  /** Public: list doctors for a hospital. */
  listHospitalDoctors: (hospital_id) => request(`/hospitals/${hospital_id}/doctors`),
  /** Hospital (self or admin): add doctor membership. */
  addDoctorToHospital: (hospital_id, doctor_user_id) => request(`/hospitals/${hospital_id}/doctors/add`, 'POST', { doctor_user_id }),
  /** Hospital (self or admin): remove doctor membership. */
  removeDoctorFromHospital: (hospital_id, doctor_user_id) => request(`/hospitals/${hospital_id}/doctors/remove`, 'POST', { doctor_user_id }),
  /** Hospital: add a weekly schedule block for a doctor. */
  addDoctorSchedule: (hospital_id, doctor_user_id, weekday, start_time, end_time, visit_cost, max_per_day) => {
    const body = { doctor_user_id, weekday, start_time, end_time, visit_cost, max_per_day };
    return request(`/hospitals/${hospital_id}/schedule/add`, 'POST', body);
  },
  /** Public: list a doctor's schedule across hospitals. */
  listDoctorSchedule: (doctor_id) => request(`/doctors/${doctor_id}/schedule`),
  /** Hospital: update a schedule block. */
  updateDoctorSchedule: (hospital_id, schedule_id, patch) => request(`/hospitals/${hospital_id}/schedule/${schedule_id}/update`, 'POST', patch),
  /** Hospital: delete a schedule block. */
  deleteDoctorSchedule: (hospital_id, schedule_id) => request(`/hospitals/${hospital_id}/schedule/${schedule_id}/delete`, 'POST', {}),
  /** Upsert a doctor's profile by doctor_user_id (name, specialty). */
  setDoctorProfile: (doctor_user_id, patch={}) => request('/doctors/profile/set', 'POST', { doctor_user_id, ...patch }),
  /** Hospital services CRUD */
  listHospitalServices: (hospital_id) => request(`/hospitals/${hospital_id}/services/list`),
  addHospitalService: (hospital_id, body) => request(`/hospitals/${hospital_id}/services/add`, 'POST', body),
  updateHospitalService: (hospital_id, service_id, patch) => request(`/hospitals/${hospital_id}/services/${service_id}/update`, 'POST', patch),
  deleteHospitalService: (hospital_id, service_id) => request(`/hospitals/${hospital_id}/services/${service_id}/delete`, 'POST', {}),
  /** Service bookings lifecycle */
  bookService: (service_id, hospital_user_id, scheduled_at) => request('/services/book', 'POST', { service_id, hospital_user_id, scheduled_at }),
  /** Book a service with optional notes and coordinates (used for Ambulance). */
    bookServiceWithDetails: (service_id, hospital_user_id, scheduled_at, notes=null, lat=null, lng=null, opts=null) => {
      const body = { service_id, hospital_user_id, scheduled_at };
      if (notes != null) body.notes = notes;
      if (lat != null) body.lat = lat; if (lng != null) body.lng = lng;
      if (opts && typeof opts === 'object') {
        // Whitelist known extra fields to avoid leaking unexpected keys
        if ('crisis_id' in opts) body.crisis_id = opts.crisis_id;
      }
      return request('/services/book', 'POST', body);
  },
  myServiceBookings: (params) => {
    const q = (params && params.crisis_id != null) ? `?crisis_id=${encodeURIComponent(params.crisis_id)}` : '';
    return request(`/services/mine${q}`);
  },
  hospitalServiceBookings: () => request('/services/hospital/bookings'),
  confirmServiceBooking: (booking_id) => request(`/services/bookings/${booking_id}/confirm`, 'POST', {}),
  declineServiceBooking: (booking_id) => request(`/services/bookings/${booking_id}/decline`, 'POST', {}),
  cancelServiceBooking: (booking_id) => request(`/services/bookings/${booking_id}/cancel/request`, 'POST', {}),
  approveServiceCancel: (booking_id) => request(`/services/bookings/${booking_id}/cancel/approve`, 'POST', {}),
  declineServiceCancel: (booking_id) => request(`/services/bookings/${booking_id}/cancel/decline`, 'POST', {}),
  hideServiceBooking: (booking_id) => request(`/services/bookings/${booking_id}/hide`, 'POST', {}),
  /** Lightweight user search for selection UIs. */
  searchUsers: (q) => request(`/users/search?q=${encodeURIComponent(q)}`),
  /** Get fire department by id. */
  getFireDepartment: (department_id) => request(`/fire/departments/${department_id}`),
  /** Get fire request by id. */
  getFireRequest: (request_id) => request(`/fire/requests/${request_id}`),
  /** Book an appointment with a doctor at a hospital. */
  bookAppointment: (doctor_user_id, hospital_user_id, starts_at, ends_at) => request('/appointments/book', 'POST', { doctor_user_id, hospital_user_id, starts_at, ends_at }),
  /** Patient: my appointments list. */
  myAppointments: () => request('/appointments/mine'),
  /** Doctor: my appointments list. */
  doctorAppointments: (opts) => request('/appointments/doctor', 'GET', undefined, opts),
  /** Patient: request to cancel an appointment (>=2 hours prior). */
  cancelAppointment: (appointment_id) => request(`/appointments/${appointment_id}/cancel/request`, 'POST', {}),
  /** Doctor: approve a cancel request. */
  approveCancelAppointment: (appointment_id) => request(`/appointments/${appointment_id}/cancel/approve`, 'POST', {}),
  /** Doctor: decline a cancel request. */
  declineCancelAppointment: (appointment_id) => request(`/appointments/${appointment_id}/cancel/decline`, 'POST', {}),
  /** Doctor: confirm/complete an appointment (booked -> done). */
  confirmAppointment: (appointment_id) => request(`/appointments/${appointment_id}/confirm`, 'POST', {}),
  /** Patient: hide (soft delete) an appointment from view. */
  hideAppointment: (appointment_id) => request(`/appointments/${appointment_id}/hide`, 'POST', {}),
  /** Incident: add a note (visible in activity timeline). */
  incidentAddNote: (incident_id, note) => request(`/incidents/${incident_id}/note`, 'POST', { note }),
  /** Incident: list activity events (status changes, notes). */
  listIncidentEvents: (incident_id, params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/incidents/${incident_id}/events${q ? `?${q}` : ''}`);
  },
  /** Fire service: list my fire teams. */
  myFireTeams: () => request('/fire/teams/mine'),
  /** Fire service: deploy a team to an incident. */
  incidentDeployFireTeam: (incident_id, team_id, note=null) => request(`/incidents/${incident_id}/fire/deploy`, 'POST', { team_id, note }),
  /** Public-safe: list fire deployments for an incident. */
  listIncidentFireDeployments: (incident_id, params={}) => {
    const all = { with_users: 1, ...params };
    const q = new URLSearchParams(all).toString();
    return request(`/incidents/${incident_id}/fire/deployments${q ? `?${q}` : ''}`);
  },
  /** Update a fire deployment's status (active -> completed/withdrawn). */
  updateIncidentFireDeploymentStatus: (incident_id, deployment_id, status) => request(`/incidents/${incident_id}/fire/deployments/${deployment_id}/status`, 'POST', { status }),
  // Social organization volunteer deployments (incident-level)
  /** Deploy volunteers to an incident (org owner). */
  incidentSocialDeploy: (incident_id, headcount, extra={}) => request(`/incidents/${incident_id}/social/deploy`, 'POST', { headcount, ...extra }),
  /** List social deployments for an incident. */
  listIncidentSocialDeployments: (incident_id, params={}) => {
    const all = { with_users: 1, ...params };
    const q = new URLSearchParams(all).toString();
    return request(`/incidents/${incident_id}/social/deployments${q ? `?${q}` : ''}`);
  },
  /** Update a social deployment's status (active -> completed/withdrawn). */
  updateIncidentSocialDeploymentStatus: (incident_id, deployment_id, status) => request(`/incidents/${incident_id}/social/deployments/${deployment_id}/status`, 'POST', { status }),
  /** Admin or incident creator: delete an incident participant by id. */
  deleteIncidentParticipant: (incident_id, participant_id) => request(`/incidents/${incident_id}/participants/${participant_id}`,'DELETE'),
  /** Hospital incident resources (self) */
  hospitalGetIncidentResources: (incident_id) => request(`/incidents/${incident_id}/hospital/resources/mine`),
  hospitalSetIncidentResources: (incident_id, body) => request(`/incidents/${incident_id}/hospital/resources/set`, 'POST', body),
  hospitalDeleteIncidentResources: (incident_id) => request(`/incidents/${incident_id}/hospital/resources/mine/delete`, 'POST', {}),
  listIncidentHospitalResources: (incident_id, params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/incidents/${incident_id}/hospital/resources/list${q ? `?${q}` : ''}`);
  },
  /** Public/participants: list hospital resources for an incident (minimal fields). */
  listIncidentHospitalResourcesPublic: (incident_id, params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/incidents/${incident_id}/hospital/resources/public${q ? `?${q}` : ''}`);
  },
  /** Send a direct message to a user (creates/finds 1:1 conversation). */
  sendDirectMessage: (target_user_id, body) => request('/messages/direct', 'POST', { target_user_id, body }),
  /** List conversations for current user. */
  listConversations: () => request('/conversations/list'),
  /** Fetch entire conversation history (ordered ASC). */
  conversationHistory: (conversation_id) => request(`/conversations/${conversation_id}/messages/all`),
  /** Send a message into an existing conversation. */
  sendConversationMessage: (conversation_id, body) => request(`/conversations/${conversation_id}/messages`, 'POST', { body }),
  /** Notifications: list (supports ?unread=1, ?page=1&page_size=20, ?type=...). */
  listNotifications: (params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/notifications${q ? `?${q}` : ''}`);
  },
  /** Mark a single notification as read. */
  markNotificationRead: (notif_id) => request(`/notifications/${notif_id}/read`, 'POST', {}),
  /** Mark all notifications as read. */
  markAllNotificationsRead: () => request('/notifications/read-all', 'POST', {}),
  /** Dashboard summary (includes notifications_unread). */
  dashboard: () => request('/dashboard'),
  /** AI chat: send message history and get assistant reply. */
  aiChat: (messages, model) => request('/ai/chat', 'POST', { messages, model }, { suppressStatus: [500] }),
  aiModels: () => request('/ai/models', 'GET'),
  aiPull: (name) => request('/ai/pull', 'POST', { name }),
  aiHealth: () => request('/ai/health', 'GET'),
  /** Admin diagnostics: aggregate geo stats and counts */
  geoStats: () => request('/diag/geo-stats'),
  // Social organizations: volunteers
  socialOrgMine: () => request('/social/organizations/mine'),
  socialOrgListVolunteers: (org_id) => request(`/social/organizations/${org_id}/volunteers/list`),
  socialOrgAddVolunteer: (org_id, user_id, role_label=null, status='accepted') => {
    const body = { user_id };
    if (role_label != null) body.role_label = role_label;
    if (status) body.status = status;
    return request(`/social/organizations/${org_id}/volunteers/add`, 'POST', body);
  },
  socialOrgUpdateVolunteer: (org_id, volunteer_id, patch) => request(`/social/organizations/${org_id}/volunteers/${volunteer_id}`, 'POST', patch),
  socialOrgRemoveVolunteer: (org_id, volunteer_id) => request(`/social/organizations/${org_id}/volunteers/${volunteer_id}`, 'DELETE'),
  socialOrgApplyToVolunteer: (org_id) => request(`/social/organizations/${org_id}/apply`, 'POST', {}),
  // Campaign participants management (owner-only bulk add)
  campaignAddVolunteers: (campaign_id, user_ids, role_label='volunteer') => request(`/campaigns/${campaign_id}/participants/add-volunteers`, 'POST', { user_ids, role_label }),
  // Campaign finance
  campaignAddDonation: (campaign_id, amount, currency='BDT', note=null) => request(`/campaigns/${campaign_id}/donations`, 'POST', { amount, currency, note }),
  campaignListDonations: (campaign_id) => request(`/campaigns/${campaign_id}/donations/list`),
  campaignAddExpense: (campaign_id, amount, currency='BDT', category=null, description=null) => request(`/campaigns/${campaign_id}/expenses`, 'POST', { amount, currency, category, description }),
  campaignListExpenses: (campaign_id) => request(`/campaigns/${campaign_id}/expenses/list`),
  campaignFinanceSummary: (campaign_id) => request(`/campaigns/${campaign_id}/finance/summary`),
  // My campaign participations (as volunteer)
  myCampaignParticipations: () => request('/campaigns/my-participations'),
  // Campaigns I own (as organization owner)
  myCampaigns: () => request('/campaigns/mine'),
  // Blood donor recruitment
  createRecruitPost: (body) => request('/blood/recruit', 'POST', body),
  listRecruitPosts: (params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/blood/recruit/list${q ? `?${q}` : ''}`);
  },
  getRecruitPost: (post_id) => request(`/blood/recruit/${post_id}`),
  updateRecruitPost: (post_id, patch) => request(`/blood/recruit/${post_id}/update`, 'PUT', patch),
  closeRecruitPost: (post_id) => request(`/blood/recruit/${post_id}/close`, 'POST', {}),
  deleteRecruitPost: (post_id) => request(`/blood/recruit/${post_id}/delete`, 'POST', {}),
  applyRecruitPost: (post_id, body) => request(`/blood/recruit/${post_id}/apply`, 'POST', body),
  listRecruitApplications: (post_id) => request(`/blood/recruit/${post_id}/applications`),
  updateApplicationStatus: (application_id, status) => request(`/blood/applications/${application_id}/status`, 'POST', { status }),
  myApplications: () => request('/blood/my-applications'),
  // Blood bank: staff & inventory
  bloodBankStaffList: () => request('/blood-bank/staff/list'),
  bloodBankStaffAdd: (body) => request('/blood-bank/staff/add', 'POST', body),
  bloodBankStaffUpdate: (staff_id, patch) => request(`/blood-bank/staff/${staff_id}/update`, 'POST', patch),
  bloodBankStaffRemove: (staff_id) => request(`/blood-bank/staff/${staff_id}/remove`, 'POST', {}),
  bloodInventoryList: () => request('/blood-bank/inventory/list'),
  bloodInventorySet: (blood_type, quantity_units) => request('/blood-bank/inventory/set', 'POST', { blood_type, quantity_units }),
  bloodInventoryIssue: (blood_type, quantity_units, extra={}) => request('/blood-bank/inventory/issue', 'POST', { blood_type, quantity_units, ...extra }),
  bloodInventoryIssuancesList: () => request('/blood-bank/inventory/issuances'),
  bloodInventoryIssuanceUpdate: (issuance_id, patch) => request(`/blood-bank/inventory/issuances/${issuance_id}/update`, 'POST', patch),
  bloodInventoryIssuanceDelete: (issuance_id) => request(`/blood-bank/inventory/issuances/${issuance_id}/delete`, 'POST', {}),
  // Blood bank donors (link existing users as donors)
  bloodBankDonorsList: () => request('/blood-bank/donors/list'),
  bloodBankDonorsOf: (bank_user_id) => request(`/blood-bank/${bank_user_id}/donors`),
  bloodBankDonorsAdd: (body) => request('/blood-bank/donors/add', 'POST', body),
  bloodBankDonorsUpdate: (donor_id, patch) => request(`/blood-bank/donors/${donor_id}/update`, 'POST', patch),
  bloodBankDonorsRemove: (donor_id) => request(`/blood-bank/donors/${donor_id}/remove`, 'POST', {}),
  // Donor meeting requests (user->donor)
  createDonorMeetingRequest: (body) => request('/blood/donor/request', 'POST', body),
  listDonorMeetingRequests: (params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/blood/donor/requests${q ? `?${q}` : ''}`);
  },
  updateDonorMeetingRequestStatus: (request_id, status, extra={}) => request(`/blood/donor/requests/${request_id}/status`, 'POST', { status, ...extra }),
  // Bank inventory requests (user->bank)
  createInventoryRequest: (body) => request('/blood/inventory/request', 'POST', body),
  listInventoryRequests: (params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/blood/inventory/requests${q ? `?${q}` : ''}`);
  },
  updateInventoryRequestStatus: (request_id, status, extra={}) => request(`/blood/inventory/requests/${request_id}/status`, 'POST', { status, ...extra }),
  // Donor profile
  myDonorProfile: () => request('/donor/profile/mine'),
  upsertDonorProfile: (body) => request('/donor/profile/upsert', 'POST', body),
  setDonorAvailability: (status, days) => request('/donor/availability/set', 'POST', { status, days }),
  /** Create an incident (used for Ambulance/EMS request). */
  createIncident: (title, description, incident_type='medical', severity='high', lat=null, lng=null) => {
    const body = { title, description, incident_type, severity };
    if (lat != null && lng != null) { body.lat = lat; body.lng = lng; }
    return request('/incidents', 'POST', body);
  },
  // ====================== Crises (admin-led) =======================
  /** Admin: create crisis around an incident. */
  createCrisis: (body) => request('/crises', 'POST', body),
  /** List crises (public-facing filtered for non-admins). */
  listCrises: (params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/crises/list${q ? `?${q}` : ''}`);
  },
  /** Get a crisis detail (includes summaries). */
  getCrisis: (crisis_id) => request(`/crises/${crisis_id}`),
  /** Admin: invite an org to a crisis. */
  crisisInvite: (crisis_id, org_user_id, org_type, note=null) => request(`/crises/${crisis_id}/invite`, 'POST', { org_user_id, org_type, note }),
  /** Admin: list invitations for a crisis. */
  crisisListInvitations: (crisis_id) => request(`/crises/${crisis_id}/invitations/list`),
  crisisMyInvitations: (params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/crises/invitations/mine${q ? `?${q}` : ''}`);
  },
  /** Org user: respond to invitation. */
  crisisInvitationRespond: (crisis_id, invitation_id, status) => request(`/crises/${crisis_id}/invitations/${invitation_id}/respond`, 'POST', { status }),
  /** Admin: delete/cancel an invitation. */
  deleteCrisisInvitation: (crisis_id, invitation_id) => request(`/crises/${crisis_id}/invitations/${invitation_id}`, 'DELETE'),
  /** Any auth user: join crisis as volunteer/participant. */
  crisisJoin: (crisis_id, role_label='volunteer') => request(`/crises/${crisis_id}/join`, 'POST', { role_label }),
  /** Any auth user: leave crisis (removes participant and/or victim enrollment). */
  crisisLeave: (crisis_id) => request(`/crises/${crisis_id}/leave`, 'POST', {}),
  /** Request to participate (admin approval). */
  crisisParticipationRequest: (crisis_id, role_label='volunteer', note=null) => request(`/crises/${crisis_id}/participation/request`, 'POST', { role_label, note }),
  crisisParticipationMine: (crisis_id) => request(`/crises/${crisis_id}/participation/mine`),
  crisisParticipationRequestsList: (crisis_id, params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/crises/${crisis_id}/participation/requests${q ? `?${q}` : ''}`);
  },
  crisisParticipationRequestDecide: (crisis_id, request_id, status) => request(`/crises/${crisis_id}/participation/requests/${request_id}/decide`, 'POST', { status }),
  /** Finance */
  crisisAddDonation: (crisis_id, amount, note=null) => request(`/crises/${crisis_id}/donations`, 'POST', { amount, note }),
  crisisListDonations: (crisis_id, params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/crises/${crisis_id}/donations/list${q ? `?${q}` : ''}`);
  },
  crisisAddExpense: (crisis_id, amount, purpose=null) => request(`/crises/${crisis_id}/expenses`, 'POST', { amount, purpose }),
  crisisListExpenses: (crisis_id, params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/crises/${crisis_id}/expenses/list${q ? `?${q}` : ''}`);
  },
  crisisFinanceSummary: (crisis_id) => request(`/crises/${crisis_id}/finance/summary`),
  crisisCompletedSummary: (crisis_id) => request(`/crises/${crisis_id}/completed/summary`),
  /** Victims */
  crisisVictimsEnroll: (crisis_id, note=null) => request(`/crises/${crisis_id}/victims/enroll`, 'POST', { note }),
  crisisVictimsUnenroll: (crisis_id) => request(`/crises/${crisis_id}/victims/unenroll`, 'POST', {}),
  crisisVictimSetStatus: (crisis_id, victim_id, status) => request(`/crises/${crisis_id}/victims/${victim_id}/status`, 'POST', { status }),
  crisisVictimAdminCreate: (crisis_id, body) => request(`/crises/${crisis_id}/victims/admin/create`, 'POST', body),
  crisisVictimGet: (crisis_id, victim_id) => request(`/crises/${crisis_id}/victims/${victim_id}`),
  crisisVictimUpdate: (crisis_id, victim_id, patch) => request(`/crises/${crisis_id}/victims/${victim_id}`, 'PUT', patch),
  crisisVictimDelete: (crisis_id, victim_id) => request(`/crises/${crisis_id}/victims/${victim_id}`, 'DELETE'),
  crisisVictimsList: (crisis_id, params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/crises/${crisis_id}/victims/list${q ? `?${q}` : ''}`);
  },
  crisisPotentialVictims: (crisis_id) => request(`/crises/${crisis_id}/potential-victims`),
  // Crisis-level blood bank integrations
  crisisBloodDonorsList: (crisis_id, params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/crises/${crisis_id}/blood/donors/list${q ? `?${q}` : ''}`);
  },
  crisisBloodDonorsAdd: (crisis_id, donor_user_id, blood_type=null, notes=null) => {
    const body = { donor_user_id };
    if (blood_type) body.blood_type = blood_type;
    if (notes != null) body.notes = notes;
    return request(`/crises/${crisis_id}/blood/donors/add`, 'POST', body);
  },
  crisisBloodDonorsRemove: (crisis_id, crisis_donor_id) => request(`/crises/${crisis_id}/blood/donors/${crisis_donor_id}/remove`, 'POST', {}),
  crisisBloodAllocationsList: (crisis_id, params={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/crises/${crisis_id}/blood/allocations${q ? `?${q}` : ''}`);
  },
  crisisBloodInventorySummary: (crisis_id) => request(`/crises/${crisis_id}/blood/inventory/summary`),
  crisisBloodAllocate: (crisis_id, blood_type, quantity_units, purpose=null) => request(`/crises/${crisis_id}/blood/allocations`, 'POST', { blood_type, quantity_units, purpose }),
  crisisBloodAllocationUpdate: (crisis_id, allocation_id, patch) => request(`/crises/${crisis_id}/blood/allocations/${allocation_id}/update`, 'POST', patch),
  crisisBloodAllocationDelete: (crisis_id, allocation_id) => request(`/crises/${crisis_id}/blood/allocations/${allocation_id}/delete`, 'POST', {}),
  /** Crisis: aggregated requests feed (participants/victims/admin). Accepts opts to suppress 403 toasts. */
  crisisRequestsAll: (crisis_id, params={}, opts={}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/crises/${crisis_id}/requests/all${q ? `?${q}` : ''}`, 'GET', undefined, opts);
  },
};

export default api;
