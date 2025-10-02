# SQL Queries Catalog

This document enumerates each raw SQL statement used by the backend API, grouped by the endpoint/function where it appears. Each entry includes a short, human-readable heading and the exact SQL.

Notes
- Placeholders %s are DB-API parameters and are bound safely by our query/execute helpers.
- Some endpoints build dynamic fragments (e.g., WHERE clauses, LIMITs). When such fragments are dynamic, we note them inline.
- Source: Backend/crisisintel/api/views.py (authoritative).

---

## Auth & Users

### register — create user
SQL:
INSERT INTO users(email,password_hash,full_name,role,status) VALUES(%s,%s,%s,%s,%s)

### register — ensure fire department (idempotent)
SQL:
SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1
INSERT INTO fire_departments(user_id,name,lat,lng) VALUES(%s,%s,%s,%s)

### login — get user
SQL:
SELECT * FROM users WHERE email=%s

### login — issue token
SQL:
INSERT INTO auth_tokens(user_id, token, csrf_token, expires_at) VALUES(%s,%s,%s,{exp})

### login — ensure fire department (idempotent)
SQL:
SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1
INSERT INTO fire_departments(user_id,name,lat,lng) VALUES(%s,%s,%s,%s)

### current_user — fetch minimal profile
SQL:
SELECT id,email,full_name,role,avatar_url FROM users WHERE id=%s

### update_current_user — update profile
SQL (dynamic SET):
UPDATE users SET ... WHERE id=%s

### get_user_public — full public profile and counts
SQL:
SELECT id,email,full_name,role,status,created_at,bio,avatar_url FROM users WHERE id=%s
SELECT COUNT(1) c FROM posts WHERE author_id=%s
SELECT COUNT(1) c FROM user_follows WHERE followee_user_id=%s
SELECT COUNT(1) c FROM user_follows WHERE follower_user_id=%s
SELECT 1 FROM user_follows WHERE follower_user_id=%s AND followee_user_id=%s

### follow_user / unfollow_user
SQL:
SELECT id FROM users WHERE id=%s
SELECT 1 FROM user_follows WHERE follower_user_id=%s AND followee_user_id=%s
INSERT INTO user_follows(follower_user_id, followee_user_id) VALUES(%s,%s)
DELETE FROM user_follows WHERE follower_user_id=%s AND followee_user_id=%s

### update_location — update + insert user location and crisis proximity check
SQL:
UPDATE users SET last_lat=%s, last_lng=%s WHERE id=%s
INSERT INTO user_locations(user_id,lat,lng,source) VALUES(%s,%s,%s,%s)
SELECT c.id AS crisis_id, COALESCE(c.radius_km, 5.0) AS radius_km, i.lat, i.lng
            FROM crises c
            JOIN incidents i ON i.id=c.incident_id
            WHERE i.lat IS NOT NULL AND i.lng IS NOT NULL AND i.status IN ('open','monitoring')
            LIMIT 500
SELECT id FROM notifications
                            WHERE user_id=%s AND type='potential_victim_detected'
                              AND JSON_EXTRACT(payload,'$.crisis_id')=%s AND is_read=0
                              AND created_at >= NOW() - INTERVAL 1 DAY
                            LIMIT 1

---

## Feed, Posts, Comments, Shares

### news_feed — unified feed (posts, shares, campaigns)
SQL:
SELECT * FROM (
    SELECT ... FROM posts p JOIN users u ... LEFT JOIN (... post_comments ...) cc ...
    UNION ALL
    SELECT ... FROM post_shares s JOIN users su ... JOIN posts p ... JOIN users au ... LEFT JOIN (... post_comments ...) cc ...
    UNION ALL
    SELECT ... FROM campaigns c JOIN users u ...
) t
ORDER BY t.item_time DESC
LIMIT 100

### create_post
SQL:
INSERT INTO posts(author_id, body, image_url) VALUES(%s,%s,%s)

### post_item — fetch/update/delete
SQL:
SELECT * FROM posts WHERE id=%s
SELECT p.id as post_id, p.body, p.image_url, p.created_at, p.updated_at,
       u.id as author_id, u.full_name as author_name, u.email as author_email
FROM posts p JOIN users u ON u.id=p.author_id WHERE p.id=%s
UPDATE posts SET body=%s, image_url=%s WHERE id=%s AND author_id=%s
DELETE FROM posts WHERE id=%s AND author_id=%s

### share_post / list_shares / share_item
SQL:
SELECT id FROM posts WHERE id=%s
INSERT INTO post_shares(post_id,user_id,comment) VALUES(%s,%s,%s)
SELECT author_id FROM posts WHERE id=%s
SELECT ps.*, u.full_name AS user_name FROM post_shares ps JOIN users u ON u.id=ps.user_id WHERE ps.post_id=%s ORDER BY ps.id DESC
SELECT * FROM post_shares WHERE id=%s
UPDATE post_shares SET comment=%s WHERE id=%s AND user_id=%s
DELETE FROM post_shares WHERE id=%s AND user_id=%s

### create_comment / list_comments / comment_item
SQL:
INSERT INTO post_comments(post_id,user_id,body) VALUES(%s,%s,%s)
SELECT author_id FROM posts WHERE id=%s
SELECT pc.*, u.full_name AS author_name, u.avatar_url AS author_avatar_url
FROM post_comments pc JOIN users u ON u.id = pc.user_id
WHERE pc.post_id = %s ORDER BY pc.created_at ASC
SELECT * FROM post_comments WHERE id=%s
UPDATE post_comments SET body=%s WHERE id=%s AND user_id=%s
DELETE FROM post_comments WHERE id=%s AND user_id=%s

### list_user_posts
SQL:
SELECT id, body, image_url, created_at FROM posts WHERE author_id=%s ORDER BY id DESC LIMIT %s

### list_user_activity — posts, shares, fire requests, appointments
SQL:
SELECT id, body, image_url, created_at FROM posts WHERE author_id=%s
SELECT id, post_id, comment, created_at FROM post_shares WHERE user_id=%s
SELECT id, description, status, created_at, assigned_department_id FROM fire_service_requests WHERE assigned_department_id IN (...)
SELECT id, starts_at, ends_at, status, created_at, hospital_user_id FROM appointments WHERE patient_user_id=%s
SELECT id, starts_at, ends_at, status, created_at, hospital_user_id FROM appointments WHERE doctor_user_id=%s

---

## Search

### search — posts, doctors, hospitals, users, fire departments, fire requests
SQL:
SELECT id, body FROM posts WHERE body LIKE %s ORDER BY id DESC LIMIT 50
SELECT id, name, specialty FROM doctors WHERE name LIKE %s OR specialty LIKE %s ORDER BY id DESC LIMIT 50
SELECT id, name FROM hospitals WHERE name LIKE %s ORDER BY id DESC LIMIT 50
SELECT h.id, h.name FROM hospitals h JOIN users u ON u.id = h.user_id WHERE (u.full_name LIKE %s OR u.email LIKE %s) ORDER BY h.id DESC LIMIT 50
SELECT id, email, full_name, role FROM users WHERE email LIKE %s OR full_name LIKE %s ORDER BY id DESC LIMIT 50
SELECT id, name, lat, lng, user_id FROM fire_departments WHERE name LIKE %s ORDER BY id DESC LIMIT 50
SELECT id, description, status, assigned_department_id FROM fire_service_requests WHERE description LIKE %s ORDER BY id DESC LIMIT 50

---

## Messaging

### create_conversation / send_direct_message
SQL:
SELECT c.id FROM conversations c ... WHERE c.is_group=0 LIMIT 1
INSERT INTO conversations(is_group, created_by_user_id) VALUES(0,%s)
INSERT INTO conversation_participants(conversation_id,user_id) VALUES(%s,%s)
INSERT INTO messages(conversation_id,sender_user_id,body) VALUES(%s,%s,%s)

### list_conversations / inbox / inbox_updates
SQL:
SELECT c.id, c.is_group, c.created_at,
       (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
       (SELECT created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) AS last_message_time,
       (... partner_name ...), (... partner_user_id ...)
FROM conversations c JOIN conversation_participants p ON p.conversation_id=c.id AND p.user_id=%s
ORDER BY COALESCE(last_message_time, c.created_at) DESC
LIMIT 100

### list_messages / conversation_history / messages_since
SQL:
SELECT id,sender_user_id,body,created_at FROM messages WHERE conversation_id=%s ORDER BY id DESC LIMIT 100
SELECT id,sender_user_id,body,created_at FROM messages WHERE conversation_id=%s ORDER BY id ASC
SELECT id,sender_user_id,body,created_at FROM messages WHERE conversation_id=%s {clause} ORDER BY id ASC LIMIT 200

### send_message — notify participants
SQL:
INSERT INTO messages(conversation_id,sender_user_id,body) VALUES(%s,%s,%s)
SELECT user_id FROM conversation_participants WHERE conversation_id=%s AND user_id<>%s

### conversation_mark_read
SQL:
SELECT conversation_id,last_read_message_id FROM conversation_participants WHERE conversation_id=%s AND user_id=%s
SELECT MAX(id) AS mid FROM messages WHERE conversation_id=%s
UPDATE conversation_participants SET last_read_message_id = GREATEST(COALESCE(last_read_message_id,0), %s) WHERE conversation_id=%s AND user_id=%s
UPDATE notifications SET is_read=1, read_at=NOW() WHERE user_id=%s AND type='message_new' AND JSON_EXTRACT(payload,'$.conversation_id')=%s AND is_read=0
SELECT COUNT(1) AS c FROM messages WHERE conversation_id=%s AND id > (SELECT COALESCE(last_read_message_id,0) FROM conversation_participants WHERE conversation_id=%s AND user_id=%s)

---

## Hospitals, Doctors, Services, Appointments

### add_doctor_to_hospital / remove_doctor_from_hospital / set_doctor_profile
SQL:
SELECT id FROM users WHERE id=%s AND role='hospital'
SELECT id,status FROM users WHERE id=%s
SELECT hospital_user_id FROM hospital_doctors WHERE hospital_user_id=%s AND doctor_user_id=%s
INSERT INTO hospital_doctors(hospital_user_id,doctor_user_id) VALUES(%s,%s)
DELETE FROM hospital_doctors WHERE hospital_user_id=%s AND doctor_user_id=%s
SELECT 1 FROM hospital_doctors WHERE doctor_user_id=%s AND hospital_user_id=%s LIMIT 1
SELECT id FROM doctors WHERE user_id=%s
UPDATE doctors SET name=%s, specialty=%s WHERE user_id=%s
INSERT INTO doctors(user_id,name,specialty) VALUES(%s,%s,%s)

### doctor schedules
SQL:
SELECT 1 FROM hospital_doctors WHERE hospital_user_id=%s AND doctor_user_id=%s
INSERT INTO hospital_doctors(hospital_user_id,doctor_user_id) VALUES(%s,%s)
INSERT INTO doctor_schedules(doctor_user_id,hospital_user_id,weekday,start_time,end_time,visit_cost,max_per_day) VALUES(%s,%s,%s,%s,%s,%s,%s)
SELECT id,doctor_user_id,hospital_user_id,weekday,start_time,end_time,visit_cost,max_per_day FROM doctor_schedules WHERE doctor_user_id=%s ORDER BY weekday,start_time
SELECT id FROM doctor_schedules WHERE id=%s AND hospital_user_id=%s
UPDATE doctor_schedules SET ... WHERE id=%s
DELETE FROM doctor_schedules WHERE id=%s AND hospital_user_id=%s

### hospital services
SQL:
SELECT id FROM hospital_services WHERE hospital_user_id=%s AND LOWER(name)='ambulance'
INSERT INTO hospital_services(...) VALUES(...)
SELECT id FROM hospital_services WHERE hospital_user_id=%s AND LOWER(name) IN ('emergency bed','er admission','emergency admission','bed') ORDER BY id LIMIT 1
INSERT INTO hospital_services(...) VALUES(...)
SELECT id,hospital_user_id,name,description,price,duration_minutes,available,max_per_day,window_start_time,window_end_time FROM hospital_services WHERE hospital_user_id=%s ORDER BY id DESC
UPDATE hospital_services SET ... WHERE id=%s AND hospital_user_id=%s
DELETE FROM hospital_services WHERE id=%s AND hospital_user_id=%s

### book_service
SQL:
SELECT id,hospital_user_id,available,max_per_day,window_start_time,window_end_time,duration_minutes,name FROM hospital_services WHERE id=%s
SELECT incident_id FROM crises WHERE id=%s
SELECT id,available_beds FROM incident_hospital_resources WHERE incident_id=%s AND hospital_user_id=%s
SELECT COUNT(1) c FROM service_bookings WHERE user_id=%s AND service_id=%s AND DATE(scheduled_at)=DATE(%s) AND status='booked'
SELECT COUNT(1) c FROM service_bookings WHERE service_id=%s AND DATE(scheduled_at)=DATE(%s) AND status='booked'
SELECT GET_LOCK(%s, 10) AS locked
SELECT COUNT(1) c FROM service_bookings WHERE service_id=%s AND DATE(scheduled_at)=DATE(%s) AND status='booked'
SELECT TIME(scheduled_at) t FROM service_bookings WHERE service_id=%s AND DATE(scheduled_at)=DATE(%s) AND status='booked'
SELECT RELEASE_LOCK(%s) AS released
INSERT INTO service_bookings(user_id,hospital_user_id,service_id,scheduled_at,status,serial,approx_time,notes,lat,lng,crisis_id) VALUES(%s,%s,%s,%s,'booked',%s,%s,%s,%s,%s,%s)
SELECT c.id FROM conversations c JOIN conversation_participants ... WHERE c.is_group=0 LIMIT 1
INSERT INTO conversations(...)
INSERT INTO conversation_participants(...)
INSERT INTO messages(...)

### list_my_service_bookings
SQL:
SELECT sb.*, hs.name AS service_name, hs.duration_minutes AS service_duration_minutes, h.id AS hospital_id, COALESCE(h.name, hu.full_name) AS hospital_name
FROM service_bookings sb JOIN hospital_services hs ON hs.id = sb.service_id LEFT JOIN hospitals h ON h.user_id = sb.hospital_user_id LEFT JOIN users hu ON hu.id = sb.hospital_user_id
WHERE sb.user_id=%s AND COALESCE(sb.hidden_by_user,0)=0{AND sb.crisis_id=%s}
ORDER BY sb.scheduled_at DESC

### list_hospital_service_bookings
SQL:
SELECT sb.*, hs.name AS service_name, u.full_name AS user_name, u.avatar_url AS user_avatar_url
FROM service_bookings sb JOIN hospital_services hs ON hs.id = sb.service_id JOIN users u ON u.id = sb.user_id
WHERE sb.hospital_user_id=%s ORDER BY sb.scheduled_at DESC

### service booking state changes
SQL:
SELECT * FROM service_bookings WHERE id=%s
UPDATE service_bookings SET status='cancelled' WHERE id=%s AND user_id=%s AND status='booked'
UPDATE service_bookings SET status='confirmed' WHERE id=%s AND status='booked'
UPDATE incident_hospital_resources SET available_beds=CASE WHEN COALESCE(available_beds,0)-1 < 0 THEN 0 ELSE COALESCE(available_beds,0)-1 END, updated_at=CURRENT_TIMESTAMP WHERE id=%s
INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,'note',%s)
UPDATE service_bookings SET status='declined' WHERE id=%s AND status='booked'
UPDATE service_bookings SET hidden_by_user=1 WHERE id=%s AND user_id=%s

### appointments (book/list/confirm/etc.)
SQL:
SELECT 1 FROM hospital_doctors WHERE hospital_user_id=%s AND doctor_user_id=%s
SELECT id, start_time, end_time, visit_cost, max_per_day FROM doctor_schedules WHERE doctor_user_id=%s AND hospital_user_id=%s AND weekday=%s ORDER BY start_time ASC
SELECT id FROM appointments WHERE patient_user_id=%s AND doctor_user_id=%s AND hospital_user_id=%s AND starts_at BETWEEN %s AND %s LIMIT 1
SELECT GET_LOCK(%s, 10) AS locked
SELECT COUNT(*) c FROM appointments WHERE doctor_user_id=%s AND hospital_user_id=%s AND starts_at BETWEEN %s AND %s
INSERT INTO appointments(patient_user_id,doctor_user_id,hospital_user_id,starts_at,ends_at,status,serial,approx_time) VALUES(%s,%s,%s,%s,%s,'booked',%s,%s)
SELECT RELEASE_LOCK(%s) AS released
SELECT COALESCE(h.name, u.full_name) AS hospital_name FROM users u LEFT JOIN hospitals h ON h.user_id=u.id WHERE u.id=%s
SELECT 1 FROM hospital_doctors WHERE doctor_user_id=%s LIMIT 1
SELECT 1 FROM appointments WHERE doctor_user_id=%s LIMIT 1
UPDATE appointments SET status='done' WHERE doctor_user_id=%s AND status='booked' AND DATE(starts_at) < CURDATE()
UPDATE appointments SET status='done' WHERE doctor_user_id=? AND status='booked' AND date(starts_at) < date('now')
SELECT DISTINCT hospital_user_id FROM doctor_schedules WHERE doctor_user_id=%s AND weekday=%s
SELECT MAX(end_time) AS last_end FROM doctor_schedules WHERE doctor_user_id=%s AND hospital_user_id=%s AND weekday=%s
UPDATE appointments SET status='done' WHERE doctor_user_id=%s AND hospital_user_id=%s AND status='booked' AND DATE(starts_at)=CURDATE() AND TIME(NOW()) > %s
UPDATE appointments SET status='done' WHERE doctor_user_id=? AND hospital_user_id=? AND status='booked' AND date(starts_at)=date('now') AND time('now') > time(?)
SELECT a.*, pu.full_name AS patient_name, pu.avatar_url AS patient_avatar_url, h.id AS hospital_id, COALESCE(h.name, hu.full_name) AS hospital_name FROM appointments a JOIN users pu ON pu.id = a.patient_user_id LEFT JOIN hospitals h ON h.user_id = a.hospital_user_id LEFT JOIN users hu ON hu.id = a.hospital_user_id WHERE a.doctor_user_id=%s ORDER BY a.starts_at DESC
UPDATE appointments SET status='done' WHERE id=%s AND doctor_user_id=%s AND status='booked'
UPDATE appointments SET hidden_by_patient=1 WHERE id=%s AND patient_user_id=%s
UPDATE appointments SET status='cancel_requested' WHERE id=%s AND patient_user_id=%s AND status='booked'
UPDATE appointments SET status='cancelled' WHERE id=%s AND doctor_user_id=%s AND status='cancel_requested'
UPDATE appointments SET status='booked' WHERE id=%s AND doctor_user_id=%s AND status='cancel_requested'

---

## Fire Service

### fire_departments — CRUD/list
SQL:
INSERT INTO fire_departments(user_id,name,lat,lng) VALUES(%s,%s,%s,%s)
SELECT id,user_id,name,lat,lng FROM fire_departments ORDER BY name ASC
SELECT id,user_id,name,lat,lng FROM fire_departments WHERE id=%s
UPDATE fire_departments SET ... WHERE id=%s

### fire_requests — create + candidate generation + listings
SQL:
-- Get department by owner
SELECT id,lat,lng FROM fire_departments WHERE user_id=%s LIMIT 1
-- Create from requester current location
SELECT ul.lat, ul.lng FROM user_locations ul JOIN (SELECT user_id, MAX(captured_at) AS max_cap FROM user_locations GROUP BY user_id) latest ON latest.user_id = ul.user_id AND latest.max_cap = ul.captured_at WHERE ul.user_id=%s LIMIT 1
INSERT INTO fire_service_requests(requester_id,lat,lng,description) VALUES(%s,%s,%s,%s)
-- Direct add/ensure candidate
SELECT id FROM fire_departments WHERE id=%s
SELECT id FROM fire_request_candidates WHERE request_id=%s AND department_id=%s
INSERT INTO fire_request_candidates(request_id, department_id, candidate_rank) VALUES(%s,%s,%s)
-- Nearby departments bbox prefilter and candidate insert
SELECT id,lat,lng FROM fire_departments WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN %s AND %s AND lng BETWEEN %s AND %s LIMIT 300
INSERT INTO fire_request_candidates(request_id, department_id, candidate_rank) VALUES(%s,%s,%s)

### assign_fire_request / deploy_fire_request_team / complete/cancel/hide
SQL:
SELECT * FROM fire_service_requests WHERE id=%s
SELECT id FROM fire_departments WHERE id=%s
UPDATE fire_service_requests SET assigned_department_id=%s, status='assigned' WHERE id=%s
UPDATE fire_service_requests SET assigned_department_id=%s, assigned_team_id=%s, status='assigned', assigned_team_at=NOW() WHERE id=%s
UPDATE fire_service_requests SET status='completed' WHERE id=%s
UPDATE fire_service_requests SET status='cancelled' WHERE id=%s
INSERT IGNORE INTO fire_request_user_hides(user_id, request_id) VALUES(%s,%s)  -- fallback to INSERT if IGNORE unsupported

### assign_fire_request_nearest — absolute-nearest fallback logic
SQL:
SELECT * FROM fire_service_requests WHERE id=%s
SELECT id,status FROM fire_request_candidates WHERE request_id=%s AND status='pending'
SELECT lat, lng FROM user_locations WHERE user_id=%s ORDER BY captured_at DESC LIMIT 1
SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_lat'
SELECT last_lat,last_lng FROM users WHERE id=%s
SELECT department_id FROM fire_request_candidates WHERE request_id=%s
SELECT id, lat, lng FROM fire_departments WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN %s AND %s AND lng BETWEEN %s AND %s LIMIT 500
SELECT COUNT(1) AS c FROM fire_request_candidates WHERE request_id=%s
INSERT INTO fire_request_candidates(request_id, department_id, candidate_rank) VALUES(%s,%s,%s)

### fire_request_candidate_accept / decline
SQL:
SELECT id FROM fire_departments WHERE user_id=%s
UPDATE fire_request_candidates SET status='accepted' WHERE id=%s
UPDATE fire_service_requests SET assigned_department_id=%s, status='assigned' WHERE id=%s
SELECT requester_id FROM fire_service_requests WHERE id=%s
UPDATE fire_request_candidates SET status='declined' WHERE id=%s
SELECT id FROM conversation_participants WHERE conversation_id=%s AND user_id=%s

### fire_activities — owner/staff views
SQL:
SELECT id FROM fire_departments WHERE user_id=%s LIMIT 1
SELECT department_id FROM fire_staff WHERE user_id=%s LIMIT 1

---

## Blood Bank & Requests

### blood requests (hospital)
SQL:
INSERT INTO blood_requests(hospital_user_id,blood_type,quantity_units,needed_by,notes) VALUES(%s,%s,%s,%s,%s)
SELECT * FROM blood_requests WHERE id=%s
SELECT * FROM blood_requests WHERE id=%s
UPDATE blood_requests SET notes=%s, quantity_units=%s, needed_by=%s, status=%s WHERE id=%s
UPDATE blood_requests SET status=%s WHERE id=%s

### bank donors & staff & inventory
SQL:
SELECT d.id, d.user_id, d.blood_type, d.notes, u.full_name AS user_full_name, u.email AS user_email FROM blood_bank_donors d JOIN users u ON u.id = d.user_id WHERE d.bank_user_id=%s ORDER BY u.full_name, u.email
SELECT d.id, d.user_id, d.blood_type, u.full_name AS user_full_name, u.avatar_url AS user_avatar_url FROM blood_bank_donors d JOIN users u ON u.id = d.user_id WHERE d.bank_user_id=%s ORDER BY u.full_name, u.id
SELECT id FROM users WHERE id=%s
INSERT INTO blood_bank_donors(bank_user_id,user_id,blood_type,notes) VALUES(%s,%s,%s,%s)
SELECT id FROM blood_bank_donors WHERE bank_user_id=%s AND user_id=%s
SELECT * FROM blood_bank_staff WHERE bank_user_id=%s ORDER BY name
INSERT INTO blood_bank_staff(bank_user_id,name,role,phone,email) VALUES(%s,%s,%s,%s,%s)
UPDATE blood_bank_staff SET ... WHERE id=%s
DELETE FROM blood_bank_staff WHERE id=%s
SELECT * FROM blood_inventory WHERE bank_user_id=%s ORDER BY blood_type
SELECT id FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s
UPDATE blood_inventory SET quantity_units=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s
INSERT INTO blood_inventory(bank_user_id,blood_type,quantity_units) VALUES(%s,%s,%s)
SELECT id, quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s
INSERT INTO blood_inventory_issuances(bank_user_id,blood_type,quantity_units,purpose,issued_to_name,issued_to_contact) VALUES(%s,%s,%s,%s,%s,%s)
SELECT * FROM blood_inventory_issuances WHERE bank_user_id=%s ORDER BY created_at DESC
UPDATE blood_inventory_issuances SET ... WHERE id=%s
DELETE FROM blood_inventory_issuances WHERE id=%s

### inventory requests (user -> bank)
SQL:
INSERT INTO blood_inventory_requests(requester_user_id,bank_user_id,blood_type,quantity_units,target_datetime,location_text,crisis_id) VALUES(%s,%s,%s,%s,%s,%s,%s)
SELECT rir.*, u.full_name AS requester_name FROM blood_inventory_requests rir JOIN users u ON u.id = rir.requester_user_id WHERE ... ORDER BY rir.created_at DESC
SELECT * FROM blood_inventory_requests WHERE id=%s
UPDATE blood_inventory_requests SET status='cancelled' WHERE id=%s
SELECT quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s
UPDATE blood_inventory_requests SET status='rejected', reject_reason='insufficient_inventory' WHERE id=%s
UPDATE blood_inventory_requests SET status='accepted' WHERE id=%s
UPDATE blood_inventory_requests SET status='rejected', reject_reason=%s WHERE id=%s
SELECT id,quantity_units FROM blood_inventory WHERE bank_user_id=%s AND blood_type=%s
UPDATE blood_inventory SET quantity_units=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s
UPDATE blood_inventory_requests SET status='completed' WHERE id=%s

### donor meeting requests (user -> donor)
SQL:
SELECT cooldown_days_after_completion, updated_at FROM blood_donor_meeting_requests WHERE donor_user_id=%s AND status='completed' ORDER BY updated_at DESC LIMIT 1
SELECT cooldown_until FROM donor_profiles WHERE user_id=%s
INSERT INTO blood_donor_meeting_requests(requester_user_id,donor_user_id,blood_type,target_datetime,location_text,crisis_id) VALUES(%s,%s,%s,%s,%s,%s)
SELECT r.*, u.full_name AS requester_name FROM blood_donor_meeting_requests r JOIN users u ON u.id = r.requester_user_id WHERE ... ORDER BY r.created_at DESC
SELECT * FROM blood_donor_meeting_requests WHERE id=%s
UPDATE blood_donor_meeting_requests SET status='cancelled' WHERE id=%s
UPDATE blood_donor_meeting_requests SET status='accepted' WHERE id=%s
UPDATE blood_donor_meeting_requests SET status='rejected' WHERE id=%s
UPDATE blood_donor_meeting_requests SET status='completed', cooldown_days_after_completion=%s WHERE id=%s
UPDATE donor_profiles SET last_donation_date=CURDATE() WHERE user_id=%s

### recruit posts & applications
SQL:
INSERT INTO blood_donor_recruit_posts(owner_user_id,blood_request_id,target_blood_type,location_text,scheduled_at,notes,status) VALUES(%s,%s,%s,%s,%s,%s,%s)
INSERT INTO blood_donor_recruit_posts(owner_user_id,blood_request_id,target_blood_type,location_text,scheduled_at,notes) VALUES(%s,%s,%s,%s,%s,%s)
SELECT * FROM blood_donor_recruit_posts WHERE id=%s
UPDATE blood_donor_recruit_posts SET notes=%s, location_text=%s, scheduled_at=%s, status=%s WHERE id=%s
UPDATE blood_donor_recruit_posts SET status='closed' WHERE id=%s
DELETE FROM blood_donor_applications WHERE recruit_post_id=%s
DELETE FROM blood_donor_recruit_posts WHERE id=%s
SELECT id FROM blood_donor_applications WHERE recruit_post_id=%s AND donor_user_id=%s
INSERT INTO blood_donor_applications(recruit_post_id,donor_user_id,availability_at,notes) VALUES(%s,%s,%s,%s)
SELECT a.*, u.full_name AS donor_full_name, u.email AS donor_email, u.avatar_url AS donor_avatar_url, dp.blood_type AS donor_blood_type FROM blood_donor_applications a JOIN users u ON u.id = a.donor_user_id LEFT JOIN donor_profiles dp ON dp.user_id = a.donor_user_id WHERE a.recruit_post_id=%s ORDER BY a.created_at ASC
UPDATE blood_donor_applications SET status=%s WHERE id=%s
SELECT blood_type FROM donor_profiles WHERE user_id=%s
SELECT id FROM blood_bank_donors WHERE bank_user_id=%s AND user_id=%s
INSERT INTO blood_bank_donors(bank_user_id,user_id,blood_type,notes) VALUES(%s,%s,%s,%s)
SELECT * FROM blood_donor_applications WHERE donor_user_id=%s ORDER BY created_at DESC

### blood direct requests
SQL:
INSERT INTO blood_direct_requests(requester_user_id,target_blood_type,quantity_units,notes) VALUES(%s,%s,%s,%s)
SELECT * FROM blood_direct_requests WHERE id=%s
SELECT id,donor_user_id,status,message,created_at FROM blood_direct_request_responses WHERE request_id=%s ORDER BY id ASC
SELECT blood_type FROM donor_profiles WHERE user_id=%s
SELECT id,status FROM blood_direct_request_responses WHERE request_id=%s AND donor_user_id=%s
UPDATE blood_direct_request_responses SET status='pending' WHERE id=%s
INSERT INTO blood_direct_request_responses(request_id,donor_user_id,message) VALUES(%s,%s,%s)
SELECT * FROM blood_direct_requests WHERE id=%s
SELECT * FROM blood_direct_request_responses WHERE id=%s AND request_id=%s
UPDATE blood_direct_request_responses SET status=%s WHERE id=%s
UPDATE blood_direct_requests SET status='accepted' WHERE id=%s
UPDATE blood_direct_requests SET status=%s WHERE id=%s

---

## Incidents & Crises

### incidents
SQL:
INSERT INTO incidents(creator_user_id,title,description,incident_type,severity,lat,lng) VALUES(%s,%s,%s,%s,%s,%s,%s)
SELECT * FROM incidents WHERE id=%s
UPDATE incidents SET status=%s, updated_at=NOW(), closed_at=NOW() WHERE id=%s
INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,%s,%s)
INSERT INTO incident_events(incident_id,user_id,event_type,note) VALUES(%s,%s,'note',%s)

### incident participants
SQL:
INSERT INTO incident_participants(incident_id,user_id,role_label,status) VALUES(%s,%s,%s,'active')
SELECT id,status FROM incident_participants WHERE incident_id=%s AND user_id=%s
UPDATE incident_participants SET status='active' WHERE id=%s
INSERT INTO incident_participants(incident_id,user_id,role_label,status) VALUES(%s,%s,%s,'active')
UPDATE incident_participants SET status='withdrawn' WHERE id=%s
DELETE FROM incident_participants WHERE id=%s

### crises
SQL:
INSERT INTO crises(incident_id,admin_user_id,radius_km) VALUES(%s,%s,%s)
SELECT c.id AS crisis_id, c.incident_id, c.radius_km, c.created_at, c.updated_at, i.title, i.description, i.status, i.severity, i.incident_type, i.lat, i.lng, i.opened_at, i.closed_at FROM crises c JOIN incidents i ON i.id=c.incident_id WHERE c.id=%s
SELECT COUNT(1) AS c FROM incident_participants WHERE incident_id=%s AND status='active'
SELECT COALESCE(SUM(amount),0) AS s FROM crisis_donations WHERE crisis_id=%s
SELECT COALESCE(SUM(amount),0) AS s FROM crisis_expenses WHERE crisis_id=%s
SELECT status FROM crisis_victims WHERE crisis_id=%s AND user_id=%s ORDER BY id DESC LIMIT 1
SELECT status FROM crisis_participation_requests WHERE crisis_id=%s AND user_id=%s ORDER BY id DESC LIMIT 1

### crisis completed summary
SQL:
SELECT c.id AS crisis_id, c.incident_id, i.status FROM crises c JOIN incidents i ON i.id=c.incident_id WHERE c.id=%s
SELECT id,user_id,status,note,created_at FROM crisis_victims WHERE crisis_id=%s ORDER BY id DESC LIMIT 500
SELECT id,blood_type,quantity_units,status,created_at FROM blood_inventory_requests WHERE crisis_id=%s ORDER BY id DESC LIMIT 500
SELECT id,donor_user_id,blood_type,status,created_at FROM blood_donor_meeting_requests WHERE crisis_id=%s ORDER BY id DESC LIMIT 500
SELECT id,hospital_user_id,service_id,status,created_at FROM service_bookings WHERE crisis_id=%s ORDER BY id DESC LIMIT 500
SELECT id,event_type,note,created_at FROM incident_events WHERE incident_id=%s ORDER BY id DESC LIMIT 1000

### crisis invitations & participation
SQL:
INSERT INTO crisis_invitations(crisis_id,org_user_id,org_type,note) VALUES(%s,%s,%s,%s)
UPDATE crisis_invitations SET status=%s, responded_at=NOW() WHERE id=%s
INSERT INTO incident_participants(incident_id,user_id,role_label,status) VALUES(%s,%s,%s,'active')
UPDATE incident_participants SET status='active', role_label=%s WHERE id=%s
DELETE FROM crisis_invitations WHERE id=%s

### crisis victims
SQL:
INSERT INTO crisis_victims(crisis_id,user_id,note) VALUES(%s,%s,%s)
UPDATE crisis_victims SET note=%s WHERE id=%s
DELETE FROM crisis_victims WHERE id=%s AND crisis_id=%s
UPDATE crisis_victims SET status=%s WHERE id=%s

### crisis victims list (public-safe)
SQL:
SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_lat'

### crisis potential victims — dedup latest location + role filter
SQL:
SELECT c.radius_km, i.lat, i.lng FROM crises c JOIN incidents i ON i.id=c.incident_id WHERE c.id=%s
SELECT ul.user_id, ul.lat, ul.lng, u.full_name AS user_name, u.avatar_url, u.email
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

### crises nearby for a user
SQL:
SELECT lat,lng FROM user_locations WHERE user_id=%s ORDER BY captured_at DESC LIMIT 1
SELECT c.id AS crisis_id, c.incident_id, COALESCE(c.radius_km, 5.0) AS radius_km, i.title, i.status, i.severity, i.lat, i.lng, i.incident_type
FROM crises c JOIN incidents i ON i.id=c.incident_id
WHERE i.lat BETWEEN %s AND %s AND i.lng BETWEEN %s AND %s AND i.status IN ('open','monitoring')
LIMIT 1000

---

## Organizations & Campaigns (Social)

### social organizations
SQL:
INSERT INTO social_organizations(user_id,name,description) VALUES(%s,%s,%s)
SELECT id,name,description,created_at FROM social_organizations ORDER BY name ASC
SELECT id,name,description,created_at FROM social_organizations WHERE user_id=%s LIMIT 1
SELECT id,name,description,created_at FROM social_organizations WHERE id=%s

### campaigns
SQL:
INSERT INTO campaigns(owner_user_id,title,description,campaign_type,starts_at,ends_at,location_text,target_metric,target_value) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)
INSERT INTO campaigns(owner_user_id,title,description,starts_at,ends_at,location_text,target_metric,target_value) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
SELECT * FROM campaigns WHERE id=%s
UPDATE campaigns SET ... WHERE id=%s
UPDATE campaigns SET status=%s WHERE id=%s
SELECT * FROM campaigns WHERE owner_user_id=%s ORDER BY created_at DESC
SELECT c.*, cp.status AS participation_status, cp.role_label, cp.id AS participation_id FROM campaign_participants cp JOIN campaigns c ON c.id=cp.campaign_id WHERE cp.user_id=%s ORDER BY cp.joined_at DESC
SELECT id FROM social_organizations WHERE id=%s AND user_id=%s

### campaign participants & finance
SQL:
SELECT owner_user_id,status FROM campaigns WHERE id=%s
SELECT id,status,role_label FROM campaign_participants WHERE campaign_id=%s AND user_id=%s
UPDATE campaign_participants SET status='pending' WHERE id=%s
INSERT INTO campaign_participants(campaign_id,user_id,role_label,status) VALUES(%s,%s,%s,'pending')
UPDATE campaign_participants SET status='withdrawn' WHERE id=%s
SELECT owner_user_id FROM campaigns WHERE id=%s
SELECT id FROM campaign_participants WHERE id=%s AND campaign_id=%s
DELETE FROM campaign_participants WHERE id=%s
UPDATE campaign_participants SET status='accepted', role_label=COALESCE(role_label,%s) WHERE id=%s
INSERT INTO campaign_participants(campaign_id,user_id,role_label,status) VALUES(%s,%s,%s,'accepted')
INSERT INTO campaign_donations(campaign_id,donor_user_id,amount,currency,note) VALUES(%s,%s,%s,%s,%s)
SELECT id,donor_user_id,amount,currency,note,created_at FROM campaign_donations WHERE campaign_id=%s ORDER BY id DESC LIMIT 200
INSERT INTO campaign_expenses(campaign_id,amount,currency,category,description,created_by_user_id) VALUES(%s,%s,%s,%s,%s,%s)
SELECT id,amount,currency,category,description,spent_at,created_by_user_id FROM campaign_expenses WHERE campaign_id=%s ORDER BY id DESC LIMIT 200
SELECT COALESCE(SUM(amount),0) AS s, COALESCE(MAX(currency),'BDT') AS currency FROM campaign_donations WHERE campaign_id=%s
SELECT COALESCE(SUM(amount),0) AS s, COALESCE(MAX(currency),'BDT') AS currency FROM campaign_expenses WHERE campaign_id=%s

---

## Misc

### dashboard
SQL:
SELECT COUNT(1) AS c FROM notifications WHERE user_id=%s AND read_at IS NULL
SELECT COUNT(1) AS c FROM blood_direct_requests WHERE status='open'
SELECT COUNT(DISTINCT conversation_id) AS c FROM conversation_participants WHERE user_id=%s
SELECT COUNT(1) AS c FROM messages m JOIN conversation_participants cp ON cp.conversation_id=m.conversation_id AND cp.user_id=%s
SELECT id FROM fire_departments WHERE user_id=%s
SELECT COUNT(1) AS c FROM fire_request_candidates c JOIN fire_departments d ON d.id=c.department_id WHERE d.user_id=%s AND c.status='pending'
SELECT COUNT(1) AS c FROM fire_service_requests WHERE requester_id=%s AND status='pending'
SELECT COALESCE(SUM(unread_part.cnt),0) AS c FROM (SELECT cp.conversation_id, (SELECT COUNT(1) FROM messages m WHERE m.conversation_id=cp.conversation_id AND (cp.last_read_message_id IS NULL OR m.id > cp.last_read_message_id)) AS cnt FROM conversation_participants cp WHERE cp.user_id=%s) unread_part

### notifications
SQL:
SELECT user_id,is_read FROM notifications WHERE id=%s
UPDATE notifications SET is_read=1, read_at=NOW() WHERE id=%s
UPDATE notifications SET is_read=1, read_at=NOW() WHERE user_id=%s AND is_read=0

### geo
SQL:
SELECT COUNT(1) AS c FROM ({sql}) t  -- dynamic subquery placeholder
SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_lat'
SELECT i.status FROM crises c JOIN incidents i ON i.id=c.incident_id WHERE c.id=%s
