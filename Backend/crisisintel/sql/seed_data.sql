-- CrisisIntel Demo Seed Data
-- Theme: Game of Thrones, House of the Dragon, Harry Potter, Demon Slayer, Death Note, Attack on Titan
-- Target DB: MySQL 8+, assumes final_normalized_schema.sql has been applied

USE crisisintel;

-- Safety: wipe existing rows (demo only)
SET FOREIGN_KEY_CHECKS=0;
TRUNCATE TABLE api_metrics;
TRUNCATE TABLE audit_logs;
TRUNCATE TABLE conversation_participants;
TRUNCATE TABLE messages;
TRUNCATE TABLE conversations;
TRUNCATE TABLE notifications;
TRUNCATE TABLE post_shares;
TRUNCATE TABLE post_comments;
TRUNCATE TABLE posts;
TRUNCATE TABLE rate_limits;
TRUNCATE TABLE service_bookings;
TRUNCATE TABLE hospital_services;
TRUNCATE TABLE appointments;
TRUNCATE TABLE doctor_schedules;
TRUNCATE TABLE hospital_doctors;
TRUNCATE TABLE doctors;
TRUNCATE TABLE hospitals;
TRUNCATE TABLE blood_donor_applications;
TRUNCATE TABLE blood_donor_recruit_posts;
TRUNCATE TABLE blood_direct_request_responses;
TRUNCATE TABLE blood_direct_requests;
TRUNCATE TABLE blood_requests;
TRUNCATE TABLE donor_profiles;
TRUNCATE TABLE blood_inventory_issuances;
TRUNCATE TABLE blood_inventory;
TRUNCATE TABLE blood_bank_donors;
TRUNCATE TABLE blood_bank_staff;
TRUNCATE TABLE incident_social_deployment_members;
TRUNCATE TABLE incident_social_deployments;
TRUNCATE TABLE social_org_volunteers;
TRUNCATE TABLE campaign_expenses;
TRUNCATE TABLE campaign_donations;
TRUNCATE TABLE campaign_participants;
TRUNCATE TABLE campaigns;
TRUNCATE TABLE incident_team_deployments;
TRUNCATE TABLE incident_hospital_resources;
TRUNCATE TABLE incident_participants;
TRUNCATE TABLE incident_events;
TRUNCATE TABLE fire_request_user_hides;
TRUNCATE TABLE fire_request_candidates;
TRUNCATE TABLE fire_service_requests;
TRUNCATE TABLE fire_team_members;
TRUNCATE TABLE fire_staff;
TRUNCATE TABLE fire_inventory;
TRUNCATE TABLE fire_teams;
TRUNCATE TABLE fire_departments;
TRUNCATE TABLE crisis_participation_requests;
TRUNCATE TABLE crisis_blood_allocations;
TRUNCATE TABLE crisis_blood_donors;
TRUNCATE TABLE crisis_victims;
TRUNCATE TABLE crisis_expenses;
TRUNCATE TABLE crisis_donations;
TRUNCATE TABLE crisis_invitations;
TRUNCATE TABLE crises;
TRUNCATE TABLE social_organizations;
TRUNCATE TABLE incident_events;
TRUNCATE TABLE incidents;
TRUNCATE TABLE user_follows;
TRUNCATE TABLE user_locations;
TRUNCATE TABLE auth_tokens;
TRUNCATE TABLE emergency_events;
TRUNCATE TABLE users;
SET FOREIGN_KEY_CHECKS=1;

-- ================== Users =====================
-- Passwords are PBKDF2-SHA256 hashed and verified by utils._verify_password.
-- Plain password for all demo accounts: demo1234
SET @PW_HASH := 'RGVtb1NhbHRGb3JTZWVkIQ==:SeDiUFFCSmPyKr99NL7EbBdXef12vyHg2nLykKN9OnM=';
INSERT INTO users (email, password_hash, full_name, role, status, last_lat, last_lng, bio, avatar_url)
VALUES
-- Game of Thrones / House of the Dragon (fan favorites only)
('jon.snow@got.local', @PW_HASH, 'Jon Snow', 'admin', 'active', 41.9038, 12.4964, 'Knows nothing, leads everything.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Jon%20Snow'),
('arya.stark@got.local', @PW_HASH, 'Arya Stark', 'regular', 'active', 51.5074, -0.1278, 'No one.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Arya%20Stark'),
('daemon.targaryen@hotd.local', @PW_HASH, 'Daemon Targaryen', 'regular', 'active', 37.9838, 23.7275, 'The Rogue Prince.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Daemon%20Targaryen'),
('aegon.targaryen@hotd.local', @PW_HASH, 'Aegon Targaryen', 'regular', 'active', 40.4168, -3.7038, 'Heir in turmoil.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Aegon%20Targaryen'),
-- Harry Potter
('harry.potter@hogwarts.local', @PW_HASH, 'Harry Potter', 'regular', 'active', 56.8198, -5.1052, 'The Boy Who Lived.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Harry%20Potter'),
('hermione.granger@hogwarts.local', @PW_HASH, 'Hermione Granger', 'regular', 'active', 55.9533, -3.1883, 'Brightest witch of her age.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Hermione%20Granger'),
('ron.weasley@hogwarts.local', @PW_HASH, 'Ron Weasley', 'regular', 'active', 55.8642, -4.2518, 'Loyal friend.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Ron%20Weasley'),
('albus.dumbledore@hogwarts.local', @PW_HASH, 'Albus Dumbledore', 'admin', 'active', 57.1497, -2.0943, 'Headmaster.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Albus%20Dumbledore'),
('minerva.mcgonagall@hogwarts.local', @PW_HASH, 'Minerva McGonagall', 'regular', 'active', 55.3781, -3.4360, 'Deputy Headmistress.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Minerva%20McGonagall'),
-- Demon Slayer (expanded)
('tanjiro.kamado@demoncorp.local', @PW_HASH, 'Tanjiro Kamado', 'regular', 'active', 35.6762, 139.6503, 'Water breathing.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Tanjiro%20Kamado'),
('nezuko.kamado@demoncorp.local', @PW_HASH, 'Nezuko Kamado', 'regular', 'active', 35.6762, 139.7503, 'Strongest imouto.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Nezuko%20Kamado'),
('zenitsu.agatsuma@demoncorp.local', @PW_HASH, 'Zenitsu Agatsuma', 'regular', 'active', 34.6937, 135.5023, 'Thunder breathing.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Zenitsu%20Agatsuma'),
('inosuke.hashibira@demoncorp.local', @PW_HASH, 'Inosuke Hashibira', 'regular', 'active', 34.6851, 135.8048, 'Beast breathing.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Inosuke%20Hashibira'),
('giyu.tomioka@demoncorp.local', @PW_HASH, 'Giyu Tomioka', 'regular', 'active', 35.1815, 136.9066, 'Water Hashira.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Giyu%20Tomioka'),
('shinobu.kocho@demoncorp.local', @PW_HASH, 'Shinobu Kocho', 'regular', 'active', 35.0116, 135.7681, 'Insect Hashira.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Shinobu%20Kocho'),
('mitsuri.kanroji@demoncorp.local', @PW_HASH, 'Mitsuri Kanroji', 'regular', 'active', 35.4437, 139.6380, 'Love Hashira.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Mitsuri%20Kanroji'),
('tengen.uzui@demoncorp.local', @PW_HASH, 'Tengen Uzui', 'regular', 'active', 34.6937, 135.5023, 'Sound Hashira.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Tengen%20Uzui'),
('muichiro.tokito@demoncorp.local', @PW_HASH, 'Muichiro Tokito', 'regular', 'active', 34.6863, 135.5200, 'Mist Hashira.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Muichiro%20Tokito'),
('kyojuro.rengoku@demoncorp.local', @PW_HASH, 'Kyojuro Rengoku', 'regular', 'active', 35.4437, 139.6380, 'Flame Hashira.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Kyojuro%20Rengoku'),
-- Death Note
('light.yagami@dn.local', @PW_HASH, 'Light Yagami', 'regular', 'active', 35.6895, 139.6917, 'Justice.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Light%20Yagami'),
('l.lawliet@dn.local', @PW_HASH, 'L Lawliet', 'regular', 'active', 35.6895, 139.7917, 'World''s greatest detective.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=L%20Lawliet'),
('misa.amane@dn.local', @PW_HASH, 'Misa Amane', 'regular', 'active', 35.6895, 139.5917, 'Second Kira.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Misa%20Amane'),
-- Attack on Titan
('eren.yeager@aot.local', @PW_HASH, 'Eren Yeager', 'regular', 'active', 35.0116, 135.7681, 'Freedom.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Eren%20Yeager'),
('mikasa.ackerman@aot.local', @PW_HASH, 'Mikasa Ackerman', 'regular', 'active', 34.6937, 135.5023, 'Strongest soldier.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Mikasa%20Ackerman'),
('armin.arlert@aot.local', @PW_HASH, 'Armin Arlert', 'regular', 'active', 34.6851, 135.8048, 'Strategist.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Armin%20Arlert'),
('levi.ackerman@aot.local', @PW_HASH, 'Levi Ackerman', 'regular', 'active', 35.1815, 136.9066, 'Humanity''s strongest.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Levi%20Ackerman'),
('hange.zoe@aot.local', @PW_HASH, 'Hange Zoë', 'regular', 'active', 43.0618, 141.3545, 'Titan researcher.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Hange%20Zo%C3%AB'),
('sasha.braus@aot.local', @PW_HASH, 'Sasha Braus', 'regular', 'active', 43.0642, 141.3469, 'Potato Girl.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Sasha%20Braus'),
('jean.kirstein@aot.local', @PW_HASH, 'Jean Kirstein', 'regular', 'active', 43.0667, 141.3500, 'Pragmatist.', 'https://api.dicebear.com/7.x/adventurer-neutral/png?size=256&seed=Jean%20Kirstein'),
-- Orgs & Services (admins/special roles)
('st.mungos@hospital.local', @PW_HASH, 'St Mungo''s Hospital', 'hospital', 'active', 51.5079, -0.1277, 'Wizarding hospital.', 'https://api.dicebear.com/7.x/shapes/png?size=256&seed=St%20Mungo%27s%20Hospital'),
('kings.landing.med@hospital.local', @PW_HASH, 'King''s Landing Medical', 'hospital', 'active', 42.6507, 18.0944, 'Maesters on duty.', 'https://api.dicebear.com/7.x/shapes/png?size=256&seed=King%27s%20Landing%20Medical'),
('goteast.firedept@fd.local', @PW_HASH, 'King''s Landing Fire Dept', 'fire_department', 'active', 42.6500, 18.0950, 'City Watch auxiliaries.', 'https://api.dicebear.com/7.x/shapes/png?size=256&seed=King%27s%20Landing%20Fire%20Dept'),
('wall.firedept@fd.local', @PW_HASH, 'Night''s Watch Fire Dept', 'fire_department', 'active', 69.6492, 18.9553, 'Beyond the Wall ops.', 'https://api.dicebear.com/7.x/shapes/png?size=256&seed=Night%27s%20Watch%20Fire%20Dept'),
('red.cross@org.local', @PW_HASH, 'Red Maesters', 'org', 'active', 41.3851, 2.1734, 'Scholarly aid.', 'https://api.dicebear.com/7.x/shapes/png?size=256&seed=Red%20Maesters'),
('order.of.phoenix@org.local', @PW_HASH, 'Order of the Phoenix', 'org', 'active', 51.7520, -1.2577, 'Secret society aid.', 'https://api.dicebear.com/7.x/shapes/png?size=256&seed=Order%20of%20the%20Phoenix'),
('blood.bank@bank.local', @PW_HASH, 'Braavos Blood Bank', 'blood_bank', 'active', 41.9981, 21.4254, 'Iron Bank''s mercy wing.', 'https://api.dicebear.com/7.x/shapes/png?size=256&seed=Braavos%20Blood%20Bank');

-- Cache IDs for easy FK usage
SET @user_jon = (SELECT id FROM users WHERE email='jon.snow@got.local');
SET @user_arya = (SELECT id FROM users WHERE email='arya.stark@got.local');
SET @user_daemon = (SELECT id FROM users WHERE email='daemon.targaryen@hotd.local');
SET @user_aegon = (SELECT id FROM users WHERE email='aegon.targaryen@hotd.local');
SET @user_harry = (SELECT id FROM users WHERE email='harry.potter@hogwarts.local');
SET @user_hermione = (SELECT id FROM users WHERE email='hermione.granger@hogwarts.local');
SET @user_ron = (SELECT id FROM users WHERE email='ron.weasley@hogwarts.local');
SET @user_dum = (SELECT id FROM users WHERE email='albus.dumbledore@hogwarts.local');
SET @user_mcg = (SELECT id FROM users WHERE email='minerva.mcgonagall@hogwarts.local');
SET @user_tanjiro = (SELECT id FROM users WHERE email='tanjiro.kamado@demoncorp.local');
SET @user_nezuko = (SELECT id FROM users WHERE email='nezuko.kamado@demoncorp.local');
SET @user_zenitsu = (SELECT id FROM users WHERE email='zenitsu.agatsuma@demoncorp.local');
SET @user_inosuke = (SELECT id FROM users WHERE email='inosuke.hashibira@demoncorp.local');
SET @user_giyu = (SELECT id FROM users WHERE email='giyu.tomioka@demoncorp.local');
SET @user_shinobu = (SELECT id FROM users WHERE email='shinobu.kocho@demoncorp.local');
SET @user_mitsuri = (SELECT id FROM users WHERE email='mitsuri.kanroji@demoncorp.local');
SET @user_tengen = (SELECT id FROM users WHERE email='tengen.uzui@demoncorp.local');
SET @user_muichiro = (SELECT id FROM users WHERE email='muichiro.tokito@demoncorp.local');
SET @user_rengoku = (SELECT id FROM users WHERE email='kyojuro.rengoku@demoncorp.local');
SET @user_light = (SELECT id FROM users WHERE email='light.yagami@dn.local');
SET @user_l = (SELECT id FROM users WHERE email='l.lawliet@dn.local');
SET @user_misa = (SELECT id FROM users WHERE email='misa.amane@dn.local');
SET @user_eren = (SELECT id FROM users WHERE email='eren.yeager@aot.local');
SET @user_mikasa = (SELECT id FROM users WHERE email='mikasa.ackerman@aot.local');
SET @user_armin = (SELECT id FROM users WHERE email='armin.arlert@aot.local');
SET @user_levi = (SELECT id FROM users WHERE email='levi.ackerman@aot.local');
SET @user_hange = (SELECT id FROM users WHERE email='hange.zoe@aot.local');
SET @user_sasha = (SELECT id FROM users WHERE email='sasha.braus@aot.local');
SET @user_jean = (SELECT id FROM users WHERE email='jean.kirstein@aot.local');
SET @user_stmungos = (SELECT id FROM users WHERE email='st.mungos@hospital.local');
SET @user_kl_med = (SELECT id FROM users WHERE email='kings.landing.med@hospital.local');
SET @user_fd_kl = (SELECT id FROM users WHERE email='goteast.firedept@fd.local');
SET @user_fd_wall = (SELECT id FROM users WHERE email='wall.firedept@fd.local');
SET @user_redmaesters = (SELECT id FROM users WHERE email='red.cross@org.local');
SET @user_oop = (SELECT id FROM users WHERE email='order.of.phoenix@org.local');
SET @user_bank = (SELECT id FROM users WHERE email='blood.bank@bank.local');

-- Follows
INSERT INTO user_follows (follower_user_id, followee_user_id) VALUES
(@user_harry, @user_hermione),
(@user_hermione, @user_harry),
(@user_arya, @user_jon),
(@user_daemon, @user_aegon),
(@user_mikasa, @user_eren);

-- Locations (latest + history)
INSERT INTO user_locations (user_id, lat, lng, source, captured_at) VALUES
(@user_jon, 41.9038, 12.4964, 'manual', NOW() - INTERVAL 2 HOUR),
(@user_arya, 51.5074, -0.1278, 'gps', NOW() - INTERVAL 1 HOUR),
(@user_harry, 56.8198, -5.1052, 'gps', NOW() - INTERVAL 30 MINUTE),
(@user_tanjiro, 35.6762, 139.6503, 'gps', NOW() - INTERVAL 20 MINUTE),
(@user_eren, 35.0116, 135.7681, 'gps', NOW() - INTERVAL 10 MINUTE);

-- Posts
INSERT INTO posts (author_id, body, image_url) VALUES
(@user_daemon, 'War is a sport, not a duty.', NULL),
(@user_aegon, 'The burden of crowns.', NULL),
(@user_hermione, 'Turn to page 394.', NULL),
(@user_light, 'A potato chip... and eat it!', NULL);

INSERT INTO post_comments (post_id, user_id, body) VALUES
( (SELECT id FROM posts WHERE author_id=@user_daemon LIMIT 1), @user_arya, 'Valar morghulis.'),
( (SELECT id FROM posts WHERE author_id=@user_aegon LIMIT 1), @user_jon, 'Careful with that fire.'),
( (SELECT id FROM posts WHERE author_id=@user_hermione LIMIT 1), @user_ron, 'Blimey!');

INSERT INTO post_shares (post_id, user_id, comment) VALUES
( (SELECT id FROM posts WHERE author_id=@user_light LIMIT 1), @user_l, 'Noted.' );

-- Notifications
INSERT INTO notifications (user_id, type, payload) VALUES
(@user_harry, 'crisis_proximity', JSON_OBJECT('message','You are inside a crisis radius','severity','info')),
(@user_jon, 'victim_enrolled', JSON_OBJECT('message','A new victim enrolled','crisis_id', 1));

-- Messaging
INSERT INTO conversations (is_group, created_by_user_id) VALUES (0, @user_harry);
SET @conv_hp = LAST_INSERT_ID();
INSERT INTO conversation_participants (conversation_id, user_id) VALUES
(@conv_hp, @user_harry), (@conv_hp, @user_hermione);
INSERT INTO messages (conversation_id, sender_user_id, body) VALUES
(@conv_hp, @user_harry, 'We need to check the Room of Requirement.'),
(@conv_hp, @user_hermione, 'Already there.');

-- Healthcare
INSERT INTO hospitals (user_id, name, address) VALUES
(@user_stmungos, 'St Mungo''s Hospital', 'London, Wizarding World'),
(@user_kl_med, 'King''s Landing Medical', 'Flea Bottom, King''s Landing');

INSERT INTO doctors (user_id, name, specialty) VALUES
(@user_dum, 'Albus Dumbledore', 'Transfiguration & Medicine'),
(@user_mcg, 'Minerva McGonagall', 'Transfiguration & Ortho');

INSERT INTO hospital_doctors (hospital_user_id, doctor_user_id) VALUES
(@user_stmungos, @user_dum),
(@user_stmungos, @user_mcg);

INSERT INTO doctor_schedules (doctor_user_id, hospital_user_id, weekday, start_time, end_time, visit_cost, max_per_day) VALUES
(@user_dum, @user_stmungos, 1, '09:00:00','12:00:00', 100.00, 20),
(@user_mcg, @user_stmungos, 3, '13:00:00','17:00:00', 85.00, 15);

INSERT INTO hospital_services (hospital_user_id, name, description, price, duration_minutes, max_per_day, available) VALUES
(@user_stmungos, 'Spell Injury Clinic','Healer consult', 50.00, 30, 60, 1),
(@user_kl_med, 'Maester Ward','General treatment', 30.00, 30, 50, 1);

INSERT INTO appointments (patient_user_id, doctor_user_id, hospital_user_id, starts_at, ends_at, status, serial) VALUES
(@user_harry, @user_dum, @user_stmungos, NOW() + INTERVAL 1 DAY, NOW() + INTERVAL 1 DAY + INTERVAL 30 MINUTE, 'booked', 1),
(@user_ron, @user_mcg, @user_stmungos, NOW() + INTERVAL 2 DAY, NOW() + INTERVAL 2 DAY + INTERVAL 30 MINUTE, 'booked', 2);

-- Blood bank & donors
INSERT INTO donor_profiles (user_id, blood_type, availability_text, last_donation_date, availability_status) VALUES
(@user_tanjiro, 'O+', 'Weekends', DATE(NOW() - INTERVAL 40 DAY), 'available'),
(@user_levi, 'A+', 'Evenings', DATE(NOW() - INTERVAL 90 DAY), 'available'),
(@user_mikasa, 'B+', 'Anytime', DATE(NOW() - INTERVAL 120 DAY), 'available');

INSERT INTO blood_requests (hospital_user_id, blood_type, quantity_units, needed_by, notes, status) VALUES
(@user_stmungos, 'O+', 3, NOW() + INTERVAL 6 HOUR, 'Quidditch accident', 'open');

INSERT INTO blood_direct_requests (requester_user_id, target_blood_type, quantity_units, notes, status) VALUES
(@user_harry, 'O+', 1, 'For a friend at Hogwarts', 'open');
SET @bdr1 = LAST_INSERT_ID();
INSERT INTO blood_direct_request_responses (request_id, donor_user_id, message, status) VALUES
(@bdr1, @user_tanjiro, 'Can donate after training', 'accepted');

INSERT INTO blood_donor_recruit_posts (owner_user_id, blood_request_id, target_blood_type, location_text, scheduled_at, notes, status, campaign_type) VALUES
(@user_stmungos, (SELECT id FROM blood_requests ORDER BY id DESC LIMIT 1), 'O+', 'Diagon Alley', NOW() + INTERVAL 1 DAY, 'Walk-in welcome', 'open', 'hospital-drive');

INSERT INTO blood_donor_applications (recruit_post_id, donor_user_id, availability_at, notes, status) VALUES
((SELECT id FROM blood_donor_recruit_posts ORDER BY id DESC LIMIT 1), @user_levi, NOW() + INTERVAL 1 DAY, 'Available 10-12', 'pending');

INSERT INTO blood_bank_staff (bank_user_id, name, role, phone, email) VALUES
(@user_bank, 'Tycho Nestoris', 'Manager', '+389 70 000 000', 'tycho@braavos.bank');

INSERT INTO blood_inventory (bank_user_id, blood_type, quantity_units) VALUES
(@user_bank, 'O+', 12),
(@user_bank, 'A+', 8);

INSERT INTO blood_inventory_issuances (bank_user_id, blood_type, quantity_units, purpose, issued_to_name, issued_to_contact, status) VALUES
(@user_bank, 'O+', 2, 'Emergency allocation', 'Hogwarts Infirmary', '+44 20 7946 0958', 'issued');

INSERT INTO blood_bank_donors (bank_user_id, user_id, blood_type, notes) VALUES
(@user_bank, @user_tanjiro, 'O+', 'Reliable donor'),
(@user_bank, @user_levi, 'A+', 'Strong arm');

INSERT INTO blood_inventory_requests (requester_user_id, bank_user_id, blood_type, quantity_units, target_datetime, location_text, status) VALUES
(@user_stmungos, @user_bank, 'O+', 4, NOW() + INTERVAL 2 DAY, 'St Mungo''s', 'pending');

INSERT INTO blood_donor_meeting_requests (requester_user_id, donor_user_id, blood_type, target_datetime, location_text, status, cooldown_days_after_completion) VALUES
(@user_stmungos, @user_levi, 'A+', NOW() + INTERVAL 2 DAY, 'Leaky Cauldron', 'pending', 90);

-- Fire service
INSERT INTO fire_departments (user_id, name, lat, lng) VALUES
(@user_fd_kl, 'King''s Landing Fire Dept', 42.6500, 18.0950),
(@user_fd_wall, 'Night''s Watch Fire Dept', 69.6492, 18.9553);

INSERT INTO fire_teams (department_id, name, status) VALUES
((SELECT id FROM fire_departments WHERE user_id=@user_fd_kl), 'Gold Cloaks Squad', 'available'),
((SELECT id FROM fire_departments WHERE user_id=@user_fd_wall), 'Ranging Squad', 'available');

-- Replace with anime leads for staff
INSERT INTO fire_staff (department_id, user_id, role, display_name) VALUES
((SELECT id FROM fire_departments WHERE user_id=@user_fd_kl), @user_tanjiro, 'Captain', 'Tanjiro'),
((SELECT id FROM fire_departments WHERE user_id=@user_fd_kl), @user_zenitsu, 'Lieutenant', 'Zenitsu'),
((SELECT id FROM fire_departments WHERE user_id=@user_fd_wall), @user_jon, 'Commander', 'Lord Commander');

INSERT INTO fire_team_members (team_id, staff_id) VALUES
((SELECT id FROM fire_teams WHERE name='Gold Cloaks Squad' LIMIT 1), (SELECT id FROM fire_staff WHERE user_id=@user_tanjiro LIMIT 1)),
((SELECT id FROM fire_teams WHERE name='Gold Cloaks Squad' LIMIT 1), (SELECT id FROM fire_staff WHERE user_id=@user_zenitsu LIMIT 1)),
((SELECT id FROM fire_teams WHERE name='Ranging Squad' LIMIT 1), (SELECT id FROM fire_staff WHERE user_id=@user_jon LIMIT 1));

INSERT INTO fire_inventory (department_id, item_name, quantity) VALUES
((SELECT id FROM fire_departments WHERE user_id=@user_fd_kl), 'Dragonscale Suit', 5),
((SELECT id FROM fire_departments WHERE user_id=@user_fd_kl), 'Water Wagon', 3);

INSERT INTO fire_service_requests (requester_id, lat, lng, description, status, assigned_department_id, assigned_team_id, assigned_team_at) VALUES
(@user_arya, 51.5074, -0.1278, 'Fire at the Inn at the Crossroads', 'assigned',
 (SELECT id FROM fire_departments WHERE user_id=@user_fd_kl),
 (SELECT id FROM fire_teams WHERE name='Gold Cloaks Squad' LIMIT 1), NOW());

INSERT INTO fire_request_candidates (request_id, department_id, candidate_rank, status) VALUES
((SELECT id FROM fire_service_requests ORDER BY id DESC LIMIT 1), (SELECT id FROM fire_departments WHERE user_id=@user_fd_kl), 1, 'accepted');

INSERT INTO fire_request_user_hides (request_id, user_id) VALUES
((SELECT id FROM fire_service_requests ORDER BY id DESC LIMIT 1), @user_aegon);

-- Incidents & related
INSERT INTO incidents (creator_user_id, title, description, incident_type, severity, lat, lng, status) VALUES
(@user_jon, 'Wildfire cache discovered', 'Wildfire barrels beneath the city', 'fire', 'high', 42.6507, 18.0944, 'open'),
(@user_harry, 'Forbidden Forest creature sighted', 'Acromantula migration', 'animal', 'medium', 56.8198, -5.1052, 'open'),
(@user_eren, 'Wall breach near Shiganshina', 'Colossal Titan sighting', 'structural', 'critical', 35.0116, 135.7681, 'open');

INSERT INTO incident_events (incident_id, user_id, event_type, note) VALUES
((SELECT id FROM incidents WHERE title='Wildfire cache discovered'), @user_daemon, 'analysis', 'Advise caution'),
((SELECT id FROM incidents WHERE title='Wall breach near Shiganshina'), @user_mikasa, 'intel', 'Titans incoming');

INSERT INTO incident_participants (incident_id, user_id, role_label, status) VALUES
((SELECT id FROM incidents WHERE title='Wildfire cache discovered'), @user_daemon, 'Responder', 'active'),
((SELECT id FROM incidents WHERE title='Wildfire cache discovered'), @user_aegon, 'Responder', 'active'),
((SELECT id FROM incidents WHERE title='Forbidden Forest creature sighted'), @user_hermione, 'Coordinator', 'active'),
((SELECT id FROM incidents WHERE title='Wall breach near Shiganshina'), @user_levi, 'Squad Leader', 'active');

INSERT INTO incident_hospital_resources (incident_id, hospital_user_id, available_beds, doctors, services) VALUES
((SELECT id FROM incidents WHERE title='Wildfire cache discovered'), @user_kl_med, 20, 'Grand Maesters', 'Burn unit'),
((SELECT id FROM incidents WHERE title='Forbidden Forest creature sighted'), @user_stmungos, 15, 'Healers', 'Anti-venom');

-- Social orgs & deployments
INSERT INTO social_organizations (user_id, name, description) VALUES
(@user_redmaesters, 'Red Maesters', 'Scholarly aid across the realm'),
(@user_oop, 'Order of the Phoenix', 'Secret society against dark threats');

INSERT INTO incident_social_deployments (incident_id, org_id, deployed_by_user_id, headcount, capabilities, note, status) VALUES
((SELECT id FROM incidents WHERE title='Forbidden Forest creature sighted'), (SELECT id FROM social_organizations WHERE name='Order of the Phoenix'), @user_harry, 12, 'Patronus perimeter', 'Forest sweep', 'active');

INSERT INTO incident_social_deployment_members (deployment_id, user_id, role_label) VALUES
((SELECT id FROM incident_social_deployments ORDER BY id DESC LIMIT 1), @user_hermione, 'Lead'),
((SELECT id FROM incident_social_deployments ORDER BY id DESC LIMIT 1), @user_ron, 'Scout');

INSERT INTO incident_team_deployments (incident_id, department_id, team_id, deployed_by_user_id, note, status) VALUES
((SELECT id FROM incidents WHERE title='Wildfire cache discovered'), (SELECT id FROM fire_departments WHERE user_id=@user_fd_kl), (SELECT id FROM fire_teams WHERE name='Gold Cloaks Squad' LIMIT 1), @user_daemon, 'Containment near the sept', 'active');

-- Campaigns
INSERT INTO campaigns (owner_user_id, title, description, status, starts_at, ends_at, location_text, target_metric, target_value) VALUES
(@user_redmaesters, 'Citadel Relief Fund', 'Aid for King''s Landing wildfire victims', 'active', NOW() - INTERVAL 3 DAY, NOW() + INTERVAL 27 DAY, 'King''s Landing', 'donations', 100000),
(@user_oop, 'Forest Protection Drive', 'Protect students from acromantulas', 'active', NOW() - INTERVAL 1 DAY, NOW() + INTERVAL 14 DAY, 'Hogwarts Grounds', 'volunteers', 200);

INSERT INTO campaign_participants (campaign_id, user_id, role_label, status) VALUES
((SELECT id FROM campaigns WHERE title='Citadel Relief Fund'), @user_daemon, 'Ambassador', 'accepted'),
((SELECT id FROM campaigns WHERE title='Forest Protection Drive'), @user_harry, 'Leader', 'accepted');

INSERT INTO social_org_volunteers (org_id, user_id, role_label, status) VALUES
((SELECT id FROM social_organizations WHERE name='Red Maesters'), @user_arya, 'Guard', 'accepted');

INSERT INTO campaign_donations (campaign_id, donor_user_id, amount, currency, note) VALUES
((SELECT id FROM campaigns WHERE title='Citadel Relief Fund'), @user_daemon, 5000.00, 'USD', 'From Dragonstone'),
((SELECT id FROM campaigns WHERE title='Citadel Relief Fund'), @user_aegon, 1000.00, 'USD', 'Crown contribution');

INSERT INTO campaign_expenses (campaign_id, amount, currency, category, description, created_by_user_id) VALUES
((SELECT id FROM campaigns WHERE title='Citadel Relief Fund'), 800.00, 'USD', 'medical', 'Burn salves', @user_redmaesters);

-- Crises & crisis features
INSERT INTO crises (incident_id, admin_user_id, radius_km) VALUES
((SELECT id FROM incidents WHERE title='Wildfire cache discovered'), @user_jon, 5.0),
((SELECT id FROM incidents WHERE title='Forbidden Forest creature sighted'), @user_harry, 8.0);

INSERT INTO crisis_invitations (crisis_id, org_user_id, org_type, note, status) VALUES
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_redmaesters, 'org', 'Medical support requested', 'pending'),
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_oop, 'org', 'Perimeter spells requested', 'accepted');

INSERT INTO crisis_donations (crisis_id, user_id, amount, note) VALUES
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_daemon, 2500.00, 'Immediate relief'),
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_aegon, 10000.00, 'Royal fund');

INSERT INTO crisis_expenses (crisis_id, user_id, amount, purpose) VALUES
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_arya, 300.00, 'Protective gear');

INSERT INTO crisis_victims (crisis_id, user_id, lat, lng, status, note, rescue_status) VALUES
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_arya, 51.5074, -0.1278, 'reported', 'Smoke inhalation', 'awaiting'),
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_daemon, 42.6507, 18.0944, 'reported', 'Minor burns', 'rescued');

INSERT INTO crisis_blood_donors (crisis_id, bank_user_id, donor_user_id, blood_type, notes) VALUES
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_bank, @user_tanjiro, 'O+', 'Ready'),
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_bank, @user_levi, 'A+', 'Standby');

INSERT INTO crisis_blood_allocations (crisis_id, bank_user_id, blood_type, quantity_units, purpose, status) VALUES
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_bank, 'O+', 2, 'For Arya', 'allocated');

INSERT INTO crisis_participation_requests (crisis_id, user_id, role_label, note, status, decided_by_user_id) VALUES
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_giyu, 'Rescuer', 'Ready to help', 'accepted', @user_jon),
((SELECT id FROM crises ORDER BY id ASC LIMIT 1), @user_shinobu, 'Rescuer', 'Send me', 'pending', NULL);

-- Service bookings linked to crises
INSERT INTO service_bookings (user_id, hospital_user_id, service_id, scheduled_at, status, serial, approx_time, notes, lat, lng, crisis_id, hidden_by_user) VALUES
(@user_arya, @user_stmungos, (SELECT id FROM hospital_services WHERE hospital_user_id=@user_stmungos LIMIT 1), NOW() + INTERVAL 1 DAY, 'booked', 1, '10:00', 'Crisis care', 51.5074, -0.1278, (SELECT id FROM crises ORDER BY id ASC LIMIT 1), 0);

-- Metrics & logs
INSERT INTO api_metrics (path, method, status_code, duration_ms, user_id) VALUES
('/api/crises/1/victims', 'GET', 200, 34, @user_jon);

INSERT INTO audit_logs (user_id, path, method, status_code, meta) VALUES
(@user_jon, '/api/seed', 'POST', 200, JSON_OBJECT('rows','demo'));

INSERT INTO rate_limits (scope_key, window_started_at, hit_count, last_hit_at) VALUES
('api:/notifications', NOW() - INTERVAL 1 HOUR, 10, NOW());

-- Legacy emergency events
INSERT INTO emergency_events (admin_id, type, title, description, status) VALUES
(@user_jon, 'fire', 'Great Sept Fire Drill', 'A controlled drill to test readiness', 'open');

-- Done.
