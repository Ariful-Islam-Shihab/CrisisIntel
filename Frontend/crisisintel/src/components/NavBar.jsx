import React, { useEffect, useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import api from '../api';

function Icon({ d, active }) {
  const cls = `w-6 h-6 ${active ? 'text-purple-700' : 'text-gray-700'}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={cls}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

/**
 * Top navigation (hidden on unauthenticated root path to preserve original Sign In layout).
 */
export default function NavBar() {
  const { pathname } = useLocation();
  const authed = !!localStorage.getItem('authToken');
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const initial = me?.full_name?.[0]?.toUpperCase?.() || 'U';
  const roleStr = String(me?.role ?? '').toLowerCase();
  const rolesList = Array.isArray(me?.roles) ? me.roles.map(r => String(r).toLowerCase()) : [];
  const isFireService = roleStr.includes('fire') || rolesList.some(r => r.includes('fire'));
  const isHospital = roleStr.includes('hospital') || rolesList.some(r => r.includes('hospital'));
  const isBloodBank = roleStr.includes('blood') || rolesList.some(r => r.includes('blood'));
  const isNGO = (
    roleStr.includes('ngo') || roleStr.includes('social') || roleStr.includes('org') ||
    rolesList.some(r => r.includes('ngo') || r.includes('social') || r.includes('org'))
  );
  const isDonor = roleStr.includes('donor') || rolesList.some(r => r.includes('donor')) || me?.is_donor === true || me?.isDonor === true;
  const isAdmin = roleStr.includes('admin') || rolesList.some(r => r.includes('admin')) || me?.is_admin === true || me?.isAdmin === true;
  const isDoctor = (
    roleStr.includes('doctor') || roleStr.includes('physician') ||
    rolesList.some(r => r.includes('doctor') || r.includes('physician')) ||
    me?.is_doctor === true || me?.isDoctor === true ||
    ('doctor_id' in (me || {}))
  );

  // Runtime probe: if we can't tell from profile, test doctor endpoint once and cache result.
  const [doctorProbe, setDoctorProbe] = useState(null);
  // Donor capability probe (server-authoritative), cache scoped per user id to avoid stale cross-account state
  const [donorProbe, setDonorProbe] = useState(null);
  // Fire staff capability probe: if user belongs to any fire team, treat like fire service for nav
  const [fireProbe, setFireProbe] = useState(null);

  // Treat these roles as organization accounts (should not see individual shortcuts)
  const isFireUser = isFireService || fireProbe === true;
  const isOrgAccount = isFireUser || isHospital || isBloodBank || isNGO;

  // Base nav (common to all)
  let nav = [
    { to: '/feed', title: 'Feed', d: 'M2.25 12l8.954-8.955a1.125 1.125 0 011.591 0L21.75 12M4.5 9.75V20.25A1.125 1.125 0 005.625 21.375H9.75v-4.875a1.125 1.125 0 011.125-1.125h2.25a1.125 1.125 0 011.125 1.125V21.375h4.125A1.125 1.125 0 0020.25 20.25V9.75M8.25 21h8.25' },
    { to: '/search', title: 'Search', d: 'M21 21l-5.197-5.197m0 0a7.5 7.5 0 10-1.06 1.06L21 21z' },
    { to: '/inbox', title: 'Messages', d: 'M2.25 6.75C2.25 5.51 3.26 4.5 4.5 4.5h15a2.25 2.25 0 012.25 2.25v8.25A2.25 2.25 0 0119.5 17.25H8.309a1.5 1.5 0 00-1.06.44l-2.44 2.44A.75.75 0 013 19.5v-12.75z' },
    { to: '/notifications', title: 'Notifications', d: 'M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9V8a6 6 0 10-12 0v1a8.967 8.967 0 01-2.311 5.772c1.733.64 3.56 1.085 5.454 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0' },
    { to: me?.id ? `/users/${me.id}` : '/feed', title: 'Profile', d: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 19.5a7.5 7.5 0 1115 0v.75H4.5v-.75z' },
  ];

  // Admin: add dashboard icon (shield)
  if (isAdmin) {
    nav.splice(1, 0, { to: '/admin', title: 'Admin', d: 'M12 2.25l7.5 3v6.75a9 9 0 01-7.5 8.773A9 9 0 014.5 12V5.25l7.5-3z' });
    // Admin: Crisis list icon (triangle alert)
    nav.splice(2, 0, { to: '/crises', title: 'Crises', d: 'M12 3l9 16.5H3L12 3zm0 6a1.5 1.5 0 00-1.5 1.5v3A1.5 1.5 0 0012 15a1.5 1.5 0 001.5-1.5v-3A1.5 1.5 0 0012 9zm0 7.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z' });
  }

  // Universal: Ensure a Crises hub icon exists for all authenticated users
  if (!nav.some(i => i.to === '/crises')) {
    const crisesIcon = { to: '/crises', title: 'Crises', d: 'M12 3l9 16.5H3L12 3zm0 6a1.5 1.5 0 00-1.5 1.5v3A1.5 1.5 0 0012 15a1.5 1.5 0 001.5-1.5v-3A1.5 1.5 0 0012 9zm0 7.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z' };
    // Place after Search when present, otherwise after Feed
    const idxSearch = nav.findIndex(i => i.to === '/search');
    if (idxSearch >= 0) nav.splice(idxSearch + 1, 0, crisesIcon);
    else nav.splice(1, 0, crisesIcon);
  }

  // Individual shortcuts (hide for org accounts)
  if (!isOrgAccount && !isDoctor) {
    // Patient appointments shortcut
    const idxCrises = nav.findIndex(i => i.to === '/crises');
    const item = { to: '/appointments/mine', title: 'My Appointments', d: 'M8 7V3m8 4V3M4 11h16M4 19h16M4 11a2 2 0 012-2h12a2 2 0 012 2M4 19a2 2 0 002 2h12a2 2 0 002-2' };
    if (idxCrises >= 0) nav.splice(idxCrises + 1, 0, item); else nav.splice(2, 0, item);
  }
  if (!isOrgAccount) {
    // Volunteer: my campaigns (current & past)
    const idxCrises = nav.findIndex(i => i.to === '/crises');
    const item = { to: '/my-campaigns', title: 'My Campaigns', d: 'M3 7.5A4.5 4.5 0 017.5 3h9A4.5 4.5 0 0121 7.5v9A4.5 4.5 0 0116.5 21h-9A4.5 4.5 0 013 16.5v-9z M7.5 8.25h9m-9 3h9m-9 3h9' };
    if (idxCrises >= 0) nav.splice(idxCrises + 2, 0, item); else nav.splice(3, 0, item);
  }

  if (isHospital) {
    nav.splice(1, 0, { to: '/hospital/service-bookings', title: 'Service Appointments', d: 'M3 5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25V9H3V5.25zM3 10.5h18v8.25A2.25 2.25 0 0118.75 21H5.25A2.25 2.25 0 013 18.75V10.5z' });
  }
  // Fire service or fire staff: add Deployments tracker icon (hexagon with dot)
  if (isFireUser) {
    const idxCrises = nav.findIndex(i => i.to === '/crises');
    const item = { to: '/fire/deployments', title: 'Deployments', d: 'M12 2.25l7.5 4.5v9l-7.5 4.5-7.5-4.5v-9L12 2.25z M12 9.75a2.25 2.25 0 110 4.5 2.25 2.25 0 010-4.5z' };
    if (idxCrises >= 0) nav.splice(idxCrises + 1, 0, item); else nav.splice(2, 0, item);
  }
  // NGO/Social org: add Social Org hub icon (two-people icon)
  if (isNGO) {
    nav.splice(2, 0, { to: '/social-org', title: 'Social Org', d: 'M18 8a3 3 0 11-6 0 3 3 0 016 0zM6 9a2.25 2.25 0 100-4.5A2.25 2.25 0 006 9zm12 4.5a4.5 4.5 0 00-9 0v.75A2.25 2.25 0 0011.25 16.5h5.5A2.25 2.25 0 0019.5 14.25v-.75zM6 12.75A3.75 3.75 0 002.25 16.5v.75A1.5 1.5 0 003.75 18.75h4.5A1.5 1.5 0 009.75 17.25v-.75A3.75 3.75 0 006 12.75z' });
  }
  // Blood bank: add direct blood requests icon
  if (isBloodBank) {
    // Add three quick-access items for bank users: Inventory, Requests, Donors
    // Inventory: collection icon
    nav.splice(2, 0, { to: '/blood-bank/inventory', title: 'Blood Inventory', d: 'M3 7.5A2.25 2.25 0 015.25 5.25h13.5A2.25 2.25 0 0121 7.5v9A2.25 2.25 0 0118.75 18.75H5.25A2.25 2.25 0 013 16.5v-9zM3 9.75h18' });
    // Requests: heart-drop icon
    nav.splice(3, 0, { to: '/blood-bank/requests', title: 'Blood Requests', d: 'M4.318 6.318a4.5 4.5 0 016.364 0L12 7.636l1.318-1.318a4.5 4.5 0 116.364 6.364L12 21 4.318 12.682a4.5 4.5 0 010-6.364z' });
    // Donors: droplet icon
    nav.splice(4, 0, { to: '/blood-bank/donors', title: 'Bank Donors', d: 'M12 2.25c-3 4.5-6.75 7.5-6.75 11.25a6.75 6.75 0 0013.5 0C18.75 9.75 15 6.75 12 2.25z' });
  }
  // Donor: add direct donor requests icon
  const showDonorIcon = (isDonor || donorProbe === true) && !isOrgAccount;
  if (showDonorIcon) {
    // Droplet icon path
    nav.splice(2, 0, { to: '/donor/requests', title: 'Donor Requests', d: 'M12 2.25c-3 4.5-6.75 7.5-6.75 11.25a6.75 6.75 0 0013.5 0C18.75 9.75 15 6.75 12 2.25z' });
  }
  // Add doctor appointments icon (stethoscope-like shape path simplified)
  const showDoctorIcon = (isDoctor || doctorProbe === true) && !isOrgAccount;
  if (showDoctorIcon) {
    nav.splice(2, 0, { to: '/appointments/doctor', title: 'My Appointments (Doctor)', d: 'M8.25 6.75a3 3 0 016 0v4.5a3 3 0 01-6 0v-4.5zM3 10.5h3m12 0h3M6 10.5v3a6 6 0 0012 0v-3' });
  }
  // As a safety net, remove individual shortcuts for any org accounts
  if (isOrgAccount) {
    const blocked = new Set([
      '/appointments/mine',            // patient appointments
      '/appointments/doctor',          // doctor appointments (org accounts shouldn't have this)
      '/donor/requests',               // donor entry
      '/my-campaigns',                 // volunteer campaigns
    ]);
    nav = nav.filter(item => !blocked.has(item.to));
  }

  const [unread, setUnread] = useState(0);
  const [pendingInvites, setPendingInvites] = useState(0);
  // Poll dashboard for unread counts while authenticated and on nav changes
  const pollRef = useRef(null);
  const inFlightRef = useRef(false);
  useEffect(() => {
    // Do not start polling when unauthenticated or on the sign-in page
    if (!authed || pathname === '/') return;
    let mounted = true;

    const fetchOnce = async () => {
      if (!mounted || inFlightRef.current) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      inFlightRef.current = true;
      try {
        const d = await api.dashboard();
        if (mounted) setUnread(Number(d.notifications_unread || 0));
        // Also fetch my crisis invitations (first page) to show pending badge
        try {
          const inv = await api.crisisMyInvitations({ page_size: 20 });
          if (mounted && inv && Array.isArray(inv.results)) {
            const cnt = inv.results.filter(r => String(r.status || '').toLowerCase() === 'pending').length;
            setPendingInvites(cnt);
          }
        } catch {}
      } catch {}
      finally {
        inFlightRef.current = false;
      }
    };

    // Clear any previous poller before starting a new one
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    // Kick off an immediate fetch, then poll every 30s
    fetchOnce();
    pollRef.current = setInterval(fetchOnce, 30000);

    return () => {
      mounted = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [pathname, authed]);

  // Doctor capability probe (server-authoritative):
  useEffect(() => {
    if (!authed) return;
    // If already known via role flags, persist and skip probing
    if (isDoctor) {
      try { localStorage.setItem('isDoctor', '1'); } catch {}
      if (doctorProbe !== true) setDoctorProbe(true);
      return;
    }
    // If cached value exists, respect it (avoids extra calls)
    const cacheKey = `isDoctor:${me?.id || '0'}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached === '1' || cached === '0') {
      if ((cached === '1') !== (doctorProbe === true)) setDoctorProbe(cached === '1');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // If the user is not a doctor, backend should return 403 or an empty/denied payload
        await api.doctorAppointments({
          silent: true,
          suppressStatus: [403],
          suppressCodes: ['not_doctor']
        });
        if (cancelled) return;
        localStorage.setItem(cacheKey, '1');
        setDoctorProbe(true);
      } catch (e) {
        if (cancelled) return;
        localStorage.setItem(cacheKey, '0');
        setDoctorProbe(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authed, isDoctor]);

  // Donor capability probe: prefer profile existence
  useEffect(() => {
    if (!authed) return;
    if (isDonor) {
      try { localStorage.setItem('isDonor', '1'); } catch {}
      if (donorProbe !== true) setDonorProbe(true);
      return;
    }
    const cacheKey = `isDonor:${me?.id || '0'}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached === '1' || cached === '0') {
      if ((cached === '1') !== (donorProbe === true)) setDonorProbe(cached === '1');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await api.myDonorProfile();
        if (cancelled) return;
        const hasProfile = !!(resp && resp.profile && (resp.profile.blood_type || resp.profile.user_id));
        localStorage.setItem(cacheKey, hasProfile ? '1' : '0');
        setDonorProbe(hasProfile);
      } catch (e) {
        if (cancelled) return;
        localStorage.setItem(cacheKey, '0');
        setDonorProbe(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authed, isDonor, me?.id]);

  // Fire staff capability probe: detect if user belongs to any fire team
  useEffect(() => {
    if (!authed) return;
    // If already known via role flags, persist and skip probing
    if (isFireService) {
      try { localStorage.setItem(`isFireUser:${me?.id || '0'}`, '1'); } catch {}
      if (fireProbe !== true) setFireProbe(true);
      return;
    }
    const cacheKey = `isFireUser:${me?.id || '0'}`;
    const cacheTsKey = `isFireUser:${me?.id || '0'}:ts`;
    const cached = localStorage.getItem(cacheKey);
    // If cached '1', trust it. If cached '0', revalidate after TTL.
    if (cached === '1') {
      if (fireProbe !== true) setFireProbe(true);
      return;
    }
    const now = Date.now();
    const ttlMs = 5 * 60 * 1000; // 5 minutes
    let allowProbe = true;
    if (cached === '0') {
      const ts = Number(localStorage.getItem(cacheTsKey) || '0');
      if (now - ts < ttlMs) {
        if (fireProbe !== false) setFireProbe(false);
        allowProbe = false;
      }
    }
    let cancelled = false;
    if (allowProbe) {
      (async () => {
        try {
          const resp = await api.myFireTeams?.();
          if (cancelled) return;
          const count = resp && (Array.isArray(resp.items) ? resp.items.length : Array.isArray(resp.results) ? resp.results.length : 0);
          const hasTeam = count > 0;
          localStorage.setItem(cacheKey, hasTeam ? '1' : '0');
          localStorage.setItem(cacheTsKey, String(now));
          setFireProbe(hasTeam);
        } catch {
          if (cancelled) return;
          localStorage.setItem(cacheKey, '0');
          localStorage.setItem(cacheTsKey, String(now));
          setFireProbe(false);
        }
      })();
    }
    return () => { cancelled = true; };
  }, [authed, isFireService, me?.id]);

  // Render nothing on sign-in route or when not authenticated (hooks still executed above)
  if (pathname === '/' || !authed) return null;

  return (
    <nav className="py-6 px-8 border-b border-gray-200">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="text-xl font-semibold"><Link to="/feed">CrisisIntel</Link></div>

          <div className="flex items-center space-x-10">
            {(() => {
              // Ensure Crisis Invitations link is present for all authenticated users
              const idxNotif = nav.findIndex(i => i.to === '/notifications');
              const inviteIcon = { to: '/crises/invitations', title: 'Crisis Invitations', d: 'M12 3l7.5 4.5v9L12 21 4.5 16.5v-9L12 3zm0 4.5a.75.75 0 00-.75.75v4.5a.75.75 0 001.5 0V8.25A.75.75 0 0012 7.5zm0 8.25a.75.75 0 100 1.5.75.75 0 000-1.5z' };
              if (!nav.some(i => i.to === '/crises/invitations')) {
                if (idxNotif >= 0) nav.splice(idxNotif, 0, inviteIcon);
                else nav.push(inviteIcon);
              }
              return nav;
            })().map(item => (
              <Link key={item.to} to={item.to} title={item.title} className="relative hover:opacity-80">
                <Icon d={item.d} active={pathname === item.to} />
                {item.to === '/notifications' && unread > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-600 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full">{unread > 99 ? '99+' : unread}</span>
                )}
                {item.to === '/crises/invitations' && pendingInvites > 0 && (
                  <span className="absolute -top-2 -right-2 bg-orange-600 text-white text-[10px] leading-none px-1.5 py-0.5 rounded-full">{pendingInvites > 99 ? '99+' : pendingInvites}</span>
                )}
              </Link>
            ))}
          </div>

          <div className="flex items-center space-x-3">
            {me?.avatar_url ? (
              <img src={me.avatar_url} alt="avatar" className="w-9 h-9 rounded-full object-cover border" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-purple-600 text-white flex items-center justify-center">
                <span className="text-sm font-bold">{initial}</span>
              </div>
            )}
            <div className="text-sm">
              <div className="font-semibold">{me?.full_name || 'User'}</div>
              <div className="text-gray-500">{me?.email || ''}</div>
            </div>
            {/* Fire Teams button moved into Feed profile card for contextual placement */}
            <button
              onClick={() => {
                try {
                  // Clean any legacy cache keys
                  const uid = me?.id || '0';
                  localStorage.removeItem('isDoctor');
                  localStorage.removeItem('isDonor');
                  localStorage.removeItem(`isFireUser:${uid}`);
                  localStorage.removeItem(`isDoctor:${uid}`);
                  localStorage.removeItem(`isDonor:${uid}`);
                } catch {}
                localStorage.clear();
                window.location.href = '/';
              }}
              className="ml-2 py-2 px-3 bg-gray-100 rounded-lg text-sm"
            >Logout</button>
          </div>
        </div>
      </div>
    </nav>
  );
}
