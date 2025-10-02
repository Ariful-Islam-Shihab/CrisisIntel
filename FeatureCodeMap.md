# CrisisIntel Feature-to-Code Map

This document maps each shipped feature to its primary frontend component(s), backend endpoint(s) with line ranges, DB tables, and representative SQL queries. Line ranges are approximate and reflect the current repo state.

> Tip: Use the file + line anchors in VS Code to jump straight to the referenced sections.

## Finalized schema reference

- Source of truth: `Backend/crisisintel/sql/final_normalized_schema.sql`
- Core tables used by features in this document (non-exhaustive):
  - Users/Auth: users, auth_tokens, user_locations, notifications
  - Social: posts, post_comments, post_shares, user_follows
  - Messaging: conversations, messages, conversation_participants
  - Healthcare: doctors, hospitals, doctor_schedules, appointments, hospital_services, service_bookings, incident_hospital_resources
  - Blood bank: donor_profiles, blood_requests, blood_direct_requests, blood_direct_request_responses, blood_donor_recruit_posts, blood_donor_applications, blood_bank_staff, blood_inventory, blood_inventory_issuances, blood_bank_donors, blood_inventory_requests, blood_donor_meeting_requests
  - Fire: fire_departments, fire_teams, fire_inventory, fire_staff, fire_team_members, fire_service_requests, fire_request_candidates, fire_request_user_hides
  - Incidents/Crisis: incidents, incident_events, incident_participants, incident_social_deployments, incident_social_deployment_members, incident_team_deployments, campaigns, campaign_participants, social_organizations, crisis_invitations, crisis_donations, crisis_expenses, crises, crisis_victims, crisis_blood_donors, crisis_blood_allocations, crisis_participation_requests

## User features

1) Create/Update/Delete/Share Post
- Frontend: `Frontend/crisisintel/src/pages/Feed.jsx` (compose + controls around 1–300 and actions across the file); `Frontend/crisisintel/src/pages/Posts.jsx` (CRUD list); `Frontend/crisisintel/src/pages/UserProfile.jsx` (compose/edit/delete panel)
- Backend: `Backend/crisisintel/api/views.py`
  - create_post: 526–538
  - post_item (GET/PUT/DELETE): 539–575
  - share_post: 576–608
  - news_feed (for listing): 360–518
- Schema/tables: posts, post_comments, post_shares, users
- Query (examples):
  - INSERT INTO posts(author_id, body, image_url) VALUES(%s,%s,%s)
  - UPDATE posts SET body=%s, image_url=%s WHERE id=%s AND author_id=%s
  - DELETE FROM posts WHERE id=%s AND author_id=%s
  - INSERT INTO post_shares(post_id,user_id,comment) VALUES(%s,%s,%s)

2) Comment CRUD
- Frontend: `Frontend/crisisintel/src/pages/Feed.jsx` (comment UI around 1200–1600); `Frontend/crisisintel/src/pages/PostDetail.jsx` (thread view)
- Backend: `Backend/crisisintel/api/views.py`
  - create_comment: 612–630
  - list_comments: 631–645 (joins users)
  - comment_item (PUT/DELETE): 646–668
- Schema/tables: post_comments, users
- Exact queries:
  - Create
    - INSERT INTO post_comments(post_id,user_id,body) VALUES(%s,%s,%s)
    - SELECT author_id FROM posts WHERE id=%s
  - List
    - SELECT pc.*, u.full_name AS author_name, u.avatar_url AS author_avatar_url
      FROM post_comments pc
      JOIN users u ON u.id = pc.user_id
      WHERE pc.post_id = %s
      ORDER BY pc.created_at ASC
  - Update
    - SELECT * FROM post_comments WHERE id=%s
    - UPDATE post_comments SET body=%s WHERE id=%s AND user_id=%s
  - Delete
    - SELECT * FROM post_comments WHERE id=%s
    - DELETE FROM post_comments WHERE id=%s AND user_id=%s

3) Direct messages (text anyone)
- Frontend: `Frontend/crisisintel/src/pages/Inbox.jsx` Lines 1–160; `Frontend/crisisintel/src/pages/UserProfile.jsx` (DM entry); `Frontend/crisisintel/src/api.js` conversation helpers 520–560
- Backend: `Backend/crisisintel/api/views.py`
  - list_conversations: 5578–5620
  - list_messages: 5622–5650
  - send_direct_message (creates/joins 1:1 conv): 5651–5717
- Schema/tables: conversations, conversation_participants, messages, users
- Exact queries:
  - Create or reuse 1:1 conversation
    - SELECT c.id FROM conversations c
      JOIN conversation_participants p1 ON p1.conversation_id=c.id AND p1.user_id=%s
      JOIN conversation_participants p2 ON p2.conversation_id=c.id AND p2.user_id=%s
      WHERE c.is_group=0
      LIMIT 1
    - INSERT INTO conversations(is_group, created_by_user_id) VALUES(0,%s)
    - INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)
    - INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)
  - List conversations (with last message and partner)
    - SELECT c.id, c.is_group, c.created_at,
             (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
             (SELECT created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message_time,
             (
                 SELECT u.full_name FROM conversation_participants cp2
                 JOIN users u ON u.id=cp2.user_id
                 WHERE cp2.conversation_id=c.id AND cp2.user_id <> %s
                 LIMIT 1
             ) AS partner_name,
             (
                 SELECT cp2.user_id FROM conversation_participants cp2
                 WHERE cp2.conversation_id=c.id AND cp2.user_id <> %s
                 LIMIT 1
             ) AS partner_user_id
      FROM conversations c
      JOIN conversation_participants p ON p.conversation_id=c.id AND p.user_id=%s
      ORDER BY COALESCE(last_message_time, c.created_at) DESC
      LIMIT 100
  - Send message
    - INSERT INTO messages(conversation_id,sender_user_id,body) VALUES(%s,%s,%s)
    - SELECT user_id FROM conversation_participants WHERE conversation_id=%s AND user_id<>%s
  - List messages
    - SELECT id,sender_user_id,body,created_at FROM messages WHERE conversation_id=%s ORDER BY id DESC LIMIT 100

4) Edit profile picture, bio
- Frontend: `pages/UserProfile.jsx` Lines 430–520 (profile edit + avatar upload)
- Backend: `views.py` user endpoints (updateCurrentUser in api.js -> `/users/me/update` handler around ~1700–1900)
- Schema/tables: users
- Query (example): UPDATE users SET full_name=%s, avatar_url=%s, bio=%s WHERE id=%s

5) Chat with Brain Rotter (AI Chatbot)
- Frontend: `Frontend/crisisintel/src/components/AIChatbot.jsx` (send/render around 100–300)
- Backend: `Backend/crisisintel/api/views.py` ai_chat 219–357; ai_models 180–195; ai_pull_model 196–217; ai_health 218–246
- Schema/tables: none (AI endpoints do not persist chat history in DB in current code)
- Queries: n/a (calls external/local model API when available)

6) Search for other users, posts, doctors, hospitals, fire
- Frontend: `Frontend/crisisintel/src/pages/Search.jsx` (80–140)
- Backend: `Backend/crisisintel/api/views.py` search 703–775
- Schema/tables: posts, doctors, hospitals, users, fire_departments, fire_service_requests
- Query (examples): SELECT ... FROM posts WHERE body LIKE %s; SELECT id,name FROM hospitals WHERE name LIKE %s

7) Follow/unfollow
- Frontend: `pages/UserProfile.jsx` Lines ~600–700 (follow/unfollow buttons) and `api.js` followUser/unfollowUser (around 336–344)
- Backend: `views.py` follow_user 1854–1869; unfollow_user 1871–1890; counts in user profile around 1805–1825
- Schema/tables: followers (implied; if absent, counts guarded). If table exists: followers(user_id, follower_id)
- Query (examples): INSERT INTO followers(user_id,follower_id) VALUES(%s,%s); DELETE FROM followers WHERE user_id=%s AND follower_id=%s

8) Appointments tab (patient + doctor)
- Frontend: `Frontend/crisisintel/src/pages/MyAppointments.jsx` (20–160)
- Backend: `Backend/crisisintel/api/views.py`
  - book_appointment: 2258–2419
  - list_my_appointments: 2420–2528
  - confirm_appointment: 2535–2585
- Schema/tables: appointments, doctors, hospitals, doctor_hospital_schedule
- Query (examples): INSERT INTO appointments(...); SELECT ... FROM appointments WHERE patient_id=%s ORDER BY starts_at DESC

## User ↔ Hospital

9) Book services (with capacity windows)
- Frontend: `Frontend/crisisintel/src/pages/HospitalProfile.jsx` (list + booking); `Frontend/crisisintel/src/pages/HospitalServices.jsx` (admin add/update)
- Backend: `Backend/crisisintel/api/views.py` services module 1101–1320 (CRUD) and book_service 1321–2199
- Schema/tables: hospitals, hospital_services, service_bookings, doctor_hospital_schedule (for some flows)
- Query (examples): INSERT INTO hospital_services(...); INSERT INTO service_bookings(...)

10) Cancel service ≥2h prior; approvals
- Frontend: `pages/MyAppointments.jsx` Lines 108–150 and `pages/HospitalServiceBookings.jsx` for hospital side
- Backend: `views.py` service booking cancel/approve/decline around 2600–2900
- Schema/tables: service_bookings
- Query: UPDATE service_bookings SET status='cancel_request' ...; then approve/decline

11) Request ambulance/emergency bed (service-based)
- Frontend: `pages/HospitalProfile.jsx` Lines 146–156 (ambulance quick-scroll) and booking UI in services list
- Backend: `/services/book` path re-used (views around 2500–2700); ambulance recognized by service name
- Schema/tables: hospital_services, service_bookings
- Query: INSERT INTO service_bookings(service_id, patient_user_id, scheduled_at, notes, lat, lng) VALUES(...)

12) Hospital receives bookings
- Frontend: `pages/HospitalServiceBookings.jsx` Lines ~10–120
- Backend: `views.py` hospitalServiceBookings endpoint around 2700–2800
- Schema/tables: service_bookings
- Query: SELECT ... FROM service_bookings WHERE hospital_user_id=%s ORDER BY id DESC

13) Doctor schedules and appointments
- Frontend: `pages/HospitalDoctorsManage.jsx` Lines 60–180 (CRUD schedule); `HospitalProfile.jsx` 200–260 (booking)
- Backend: `views.py` doctor schedule endpoints around 2140–2360
- Schema/tables: doctors, doctor_hospital_schedule, appointments
- Query: INSERT INTO doctor_hospital_schedule(...); UPDATE ...; DELETE ...

## User ↔ Blood bank

14) Request blood to banks; cancel/hide
- Frontend: `Frontend/crisisintel/src/pages/BloodBankRequests.jsx`; `Frontend/crisisintel/src/api.js` inventory request helpers 470–520
- Backend: `Backend/crisisintel/api/views.py` blood inventory request endpoints 2912–3567
- Schema/tables: blood_inventory_requests (or blood_bank inventory tables as defined in views)
- Query: INSERT INTO blood_inventory_requests(...); UPDATE ... SET status=...

15) Join as blood donor from recruitment posts; request blood to donors
- Frontend: `pages/RecruitBrowse.jsx` and `pages/RecruitManage.jsx` Lines ~10–220; `api.js` blood recruit methods Lines 430–470
- Backend: `views.py` recruit posts/applications around 3280–3440; direct donor requests around 4180–4220
- Schema/tables: blood_recruit_posts, blood_donor_applications, donor_profiles, blood_direct_requests, blood_direct_request_responses
- Query: INSERT INTO blood_recruit_posts(...); INSERT INTO blood_donor_applications(...)

16) Blood bank features: staff, inventory, donor lists
- Frontend: pages under `blood-bank/*` (inventory lists, issuances); `api.js` inventory methods Lines 470–518
- Backend: `views.py` blood-bank staff/inventory endpoints around 3440–4180
- Schema/tables: blood_bank_staff, blood_bank_inventory, blood_inventory_issuances
- Query: INSERT/UPDATE inventory; SELECT issuances

## Social organizations

17) Participate in campaigns; donations/expenses visibility
- Frontend: `Frontend/crisisintel/src/pages/CampaignDetail.jsx` Lines 10–380
- Backend: `Backend/crisisintel/api/views.py` campaign donations/expenses 4736–4812
- Schema/tables: campaigns, campaign_donations, campaign_expenses, campaign_participants
- Query: INSERT INTO campaign_donations(...); SELECT ... FROM campaign_expenses WHERE campaign_id=%s

18) Org volunteers and campaigns CRUD
- Frontend: `pages/OrgVolunteers.jsx` Lines ~10–220; `pages/SocialOrg.jsx` overview; `pages/CampaignDetail.jsx` participants management 300–370
- Backend: `views.py` social org volunteers + campaigns around 5880–6200
- Schema/tables: social_organizations, organization_volunteers, campaigns, campaign_participants
- Query: INSERT INTO organization_volunteers(...); DELETE FROM ... WHERE id=%s

## Fire service

19) User fire request (auto-assign nearest department)
- Frontend: `Frontend/crisisintel/src/pages/Feed.jsx` Lines 560–700 (request form); `Frontend/crisisintel/src/pages/FireRequestDetail.jsx` (detail)
- Backend: `Backend/crisisintel/api/views.py` fire_requests 4890–5393 (create/list + candidate generation incl. fallback), accept/decline 5505–5543
- Schema/tables: fire_service_requests, fire_departments, fire_request_candidates, fire_request_user_hides, users
- Exact queries:
  - List (base + filters)
    - SELECT fsr.id,fsr.requester_id,fsr.lat,fsr.lng,fsr.description,fsr.status,
             fsr.assigned_department_id,fsr.assigned_team_id,fsr.assigned_team_at,fsr.created_at,
             t.name AS assigned_team_name,t.status AS assigned_team_status, d.name AS assigned_department_name, d.user_id AS assigned_department_owner_user_id 
      FROM fire_service_requests fsr 
      LEFT JOIN fire_teams t ON t.id=fsr.assigned_team_id 
      LEFT JOIN fire_departments d ON d.id=fsr.assigned_department_id
      [WHERE status filter / mine filter / fire_service scope conditions]
      ORDER BY fsr.created_at DESC
  - Candidate enrichment for mine=1
    - SELECT c.request_id,c.department_id,c.status,fd.name,fd.user_id AS owner_user_id FROM fire_request_candidates c JOIN fire_departments fd ON fd.id=c.department_id WHERE c.request_id IN (%s,...)
  - Create request (with last-known location fallback)
    - SELECT ul.lat, ul.lng
      FROM user_locations ul
      JOIN (
          SELECT user_id, MAX(captured_at) AS max_cap
          FROM user_locations
          GROUP BY user_id
      ) latest ON latest.user_id = ul.user_id AND latest.max_cap = ul.captured_at
      WHERE ul.user_id=%s
      LIMIT 1
    - INSERT INTO fire_service_requests(requester_id,lat,lng,description) VALUES(%s,%s,%s,%s)
  - Nearest candidate search (bbox prefilter)
    - SELECT id,lat,lng FROM fire_departments WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN %s AND %s AND lng BETWEEN %s AND %s LIMIT 300
    - INSERT INTO fire_request_candidates(request_id, department_id, candidate_rank) VALUES(%s,%s,%s)
    - SELECT user_id FROM fire_departments WHERE id=%s
    - SELECT user_id FROM fire_staff WHERE department_id=%s
  - Cancel
    - SELECT id, requester_id, status, assigned_department_id, assigned_team_id FROM fire_service_requests WHERE id=%s
    - UPDATE fire_service_requests SET status='cancelled' WHERE id=%s
  - Hide (idempotent)
    - INSERT IGNORE INTO fire_request_user_hides(user_id, request_id) VALUES(%s,%s)
    - Fallback: SELECT id FROM fire_request_user_hides WHERE user_id=%s AND request_id=%s; INSERT INTO fire_request_user_hides(user_id, request_id) VALUES(%s,%s)
  - Department activities
    - SELECT fsr.id, fsr.description, fsr.status, fsr.assigned_team_id, fsr.assigned_team_at, fsr.completed_at, fsr.created_at,
             t.name AS team_name, t.status AS team_status, fd.name AS assigned_department_name, fsr.description AS location_text 
      FROM fire_service_requests fsr 
      LEFT JOIN fire_teams t ON t.id=fsr.assigned_team_id 
      LEFT JOIN fire_departments fd ON fd.id=fsr.assigned_department_id 
      WHERE fsr.assigned_department_id=%s ORDER BY fsr.id DESC
  - Assign nearest (retroactive)
    - SELECT lat, lng FROM user_locations WHERE user_id=%s ORDER BY captured_at DESC LIMIT 1
    - SELECT id, lat, lng FROM fire_departments WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN %s AND %s AND lng BETWEEN %s AND %s LIMIT 500
    - SELECT department_id FROM fire_request_candidates WHERE request_id=%s
    - SELECT COUNT(1) AS c FROM fire_request_candidates WHERE request_id=%s
    - INSERT INTO fire_request_candidates(request_id, department_id, candidate_rank) VALUES(%s,%s,%s)
    - SELECT user_id FROM fire_departments WHERE id=%s

20) Cancel pending if not deployed; see received department/team
- Frontend: `Frontend/crisisintel/src/pages/FireRequestDetail.jsx` (80–180); `Frontend/crisisintel/src/pages/FireDeployments.jsx` 1–160
- Backend: `Backend/crisisintel/api/views.py` fire activities 5317–5393; cancel flow 5261–5294; department activities 5326–5367
- Schema/tables: fire_service_requests, fire_departments, fire_teams, fire_team_members, fire_staff
- Exact queries:
  - Cancel
    - SELECT id, requester_id, status, assigned_department_id, assigned_team_id FROM fire_service_requests WHERE id=%s
    - UPDATE fire_service_requests SET status='cancelled' WHERE id=%s
  - Activities (department)
    - SELECT fsr.id, fsr.description, fsr.status, fsr.assigned_team_id, fsr.assigned_team_at, fsr.completed_at, fsr.created_at,
             t.name AS team_name, t.status AS team_status, fd.name AS assigned_department_name, fsr.description AS location_text 
      FROM fire_service_requests fsr 
      LEFT JOIN fire_teams t ON t.id=fsr.assigned_team_id 
      LEFT JOIN fire_departments fd ON fd.id=fsr.assigned_department_id 
      WHERE fsr.assigned_department_id=%s ORDER BY fsr.id DESC
  - Deploy team to request
    - SELECT id,assigned_department_id,status FROM fire_service_requests WHERE id=%s
    - SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1
    - SELECT id,department_id FROM fire_teams WHERE id=%s AND department_id=%s
    - UPDATE fire_service_requests SET assigned_department_id=%s, assigned_team_id=%s, status='assigned', assigned_team_at=NOW() WHERE id=%s
    - UPDATE fire_service_requests SET assigned_team_id=%s, assigned_team_at=NOW(), status='assigned' WHERE id=%s
    - UPDATE fire_service_requests SET assigned_team_id=%s, assigned_team_at=NOW() WHERE id=%s
    - SELECT s.user_id FROM fire_team_members m
      JOIN fire_staff s ON s.id = m.staff_id
      WHERE m.team_id=%s

21) Fire service manage staff/teams and deployments
- Frontend: `Frontend/crisisintel/src/components/FireTeams.js` 40–360; `Frontend/crisisintel/src/pages/FireDeployments.jsx` 1–160; `Frontend/crisisintel/src/pages/FireDepartmentProfile.jsx` 100–200
- Backend: `Backend/crisisintel/api/views.py` fire department teams/staff CRUD 5843–6021; department inventory 5954–5966; request team assign 5145–5185
- Schema/tables: fire_departments, fire_teams, fire_staff, fire_team_members, fire_inventory
- Exact queries (highlights):
  - Teams/Staff CRUD (owner/admin)
    - SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1
    - INSERT INTO fire_teams(department_id,name,status) VALUES(%s,%s,%s)
    - UPDATE fire_teams SET name=%s, status=%s WHERE id=%s AND department_id=%s
    - DELETE FROM fire_teams WHERE id=%s AND department_id=%s
    - INSERT INTO fire_staff(department_id,user_id,role,display_name) VALUES(%s,%s,%s,%s)
    - UPDATE fire_staff SET role=%s, display_name=%s WHERE department_id=%s AND user_id=%s
    - DELETE FROM fire_staff WHERE department_id=%s AND user_id=%s
    - INSERT INTO fire_team_members(team_id, staff_id) VALUES(%s,%s)
    - DELETE FROM fire_team_members WHERE team_id=%s AND staff_id=%s
  - Inventory (if used)
    - INSERT INTO fire_inventory(department_id,item_name,quantity) VALUES(%s,%s,%s)
    - UPDATE fire_inventory SET item_name=%s, quantity=%s WHERE id=%s AND department_id=%s
    - DELETE FROM fire_inventory WHERE id=%s AND department_id=%s

## Admin & Crisis

22) Admin panel (logs/dashboard)
- Frontend: `Frontend/crisisintel/src/pages/Notifications.jsx` and dashboard widgets in `Frontend/crisisintel/src/pages/Feed.jsx`
- Backend: `Backend/crisisintel/api/views.py` dashboard and counts 5720–5800; diag/geo-stats 5800–5860
- Schema/tables: notifications, api_metrics, audit_logs
- Query: SELECT COUNT(*) FROM notifications WHERE user_id=%s AND read_at IS NULL

23) Create crisis (description, radius, location)
- Frontend: `Frontend/crisisintel/src/pages/CrisisNew.jsx` 110–190; `Frontend/crisisintel/src/pages/CrisisList.jsx` 60–100
- Backend: `Backend/crisisintel/api/views.py` crises create/list 7200–7397 (plus related invitation flows 7255–7360)
- Schema/tables: incidents, crises
- Query: INSERT INTO incidents(title,description,lat,lng,incident_type,severity) VALUES(...); INSERT INTO crises(incident_id,admin_user_id,radius_km) VALUES(...)

24) Potential victims (inside radius) and enroll as victim
- Frontend: `Frontend/crisisintel/src/pages/CrisisDetail.jsx` Lines 2440–2640 (Potential Victims panel)
- Backend: `Backend/crisisintel/api/views.py` crisis_potential_victims 7888–8045 (bbox+Haversine; dedupe + exclude org roles); victims enroll/status/list 7628–7807
- Schema/tables: user_locations, crises, incidents, crisis_victims, users
- Exact queries:
  - Potential victims (with user info)
    - SELECT ul.user_id, ul.lat, ul.lng, u.full_name AS user_name, u.avatar_url, u.email
      FROM user_locations ul
      JOIN users u ON u.id = ul.user_id
      WHERE u.role IN ('regular','admin')
        AND ul.id = (
            SELECT ul2.id
            FROM user_locations ul2
            WHERE ul2.user_id = ul.user_id
            ORDER BY ul2.captured_at DESC, ul2.id DESC
            LIMIT 1
        )
        AND ul.lat BETWEEN %s AND %s
        AND ul.lng BETWEEN %s AND %s
      LIMIT 1000
  - Potential victims (ids/coords only)
    - SELECT ul.user_id, ul.lat, ul.lng
      FROM user_locations ul
      JOIN users u ON u.id = ul.user_id
      WHERE u.role IN ('regular','admin')
        AND ul.id = (
            SELECT ul2.id
            FROM user_locations ul2
            WHERE ul2.user_id = ul.user_id
            ORDER BY ul2.captured_at DESC, ul2.id DESC
            LIMIT 1
        )
        AND ul.lat BETWEEN %s AND %s
        AND ul.lng BETWEEN %s AND %s
      LIMIT 1000
  - Enroll/status/list (highlights)
    - INSERT INTO crisis_victims(crisis_id,user_id,lat,lng,status,note) VALUES(%s,%s,%s,%s,%s,%s)
    - SELECT cv.id, cv.user_id, cv.status, cv.note, cv.created_at, u.full_name AS user_name, u.avatar_url, u.email,
             loc.last_lat AS lat, loc.last_lng AS lng, loc.last_loc_time, NULL AS user_last_lat, NULL AS user_last_lng
      FROM crisis_victims cv
      JOIN users u ON u.id=cv.user_id
      LEFT JOIN (
         SELECT ul.user_id, ul.lat AS last_lat, ul.lng AS last_lng, ul.captured_at AS last_loc_time
         FROM user_locations ul
         JOIN (
           SELECT user_id, MAX(captured_at) AS latest FROM user_locations GROUP BY user_id
         ) l ON l.user_id=ul.user_id AND l.latest=ul.captured_at
      ) loc ON loc.user_id=cv.user_id
      WHERE cv.crisis_id=%s

25) Crisis invitations to orgs; participate/cancel
- Frontend: `Frontend/crisisintel/src/pages/CrisisDetail.jsx` 400–1200 (org panels)
- Backend: `Backend/crisisintel/api/views.py` invitations CRUD/list/respond 7255–7360; participation requests 7431–7566
- Schema/tables: crisis_invitations, incident_participants
- Query: INSERT INTO crisis_invitations(...); SELECT ... FROM incident_participants WHERE incident_id=%s

26) Crisis donations and expenses visibility
- Frontend: `Frontend/crisisintel/src/pages/CrisisDetail.jsx` 1200–1600
- Backend: `Backend/crisisintel/api/views.py` crisis donations/expenses/list/summary 7573–7619
- Schema/tables: crisis_donations, crisis_expenses
- Query: INSERT INTO crisis_donations(...); SELECT ... FROM crisis_expenses WHERE crisis_id=%s ORDER BY id DESC

27) See and approve requests by victims (blood, fire, beds, etc.)
- Frontend: `CrisisDetail.jsx` Lines 60–220 (requests aggregation) and section anchors under "Requests"
- Backend: `views.py` crisis_requests_all around 6900–7060 (aggregates per-role)
- Schema/tables: joins across blood/service/fire request tables
- Query: multiple SELECTs unioned/merged by type; per-role filters

28) End crisis and view logs
- Frontend: `Frontend/crisisintel/src/pages/CrisisDetail.jsx` Lines 1600–1760 (completion summary panel)
- Backend: `Backend/crisisintel/api/views.py` crisis_completed_summary 7233–7254
- Schema/tables: crises, incidents, incident_events
- Query: UPDATE crises SET status='completed' ...; SELECT ... incident events

---

Notes
- Line ranges are approximate anchors to help you navigate quickly; if your local edits shift them slightly, use the symbol names indicated.
- Some subsystems (blood-bank inventory, volunteers) span multiple endpoints; above lists the primary ones you’ll touch when testing.
