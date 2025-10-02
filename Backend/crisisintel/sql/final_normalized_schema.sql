-- CrisisIntel Final Normalized Schema (3NF/near-BCNF)
-- Target: MySQL 8+ (utf8mb4)
-- This schema consolidates all tables used by the app across base schema files,
-- incremental SQL scripts, runtime-created tables in views, and tests.
-- Naming and columns are aligned to what the backend code expects today,
-- so you can load this file and run the app without code changes.

CREATE DATABASE IF NOT EXISTS crisisintel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE crisisintel;

-- =============== Core: Users & Auth =====================
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'regular',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  -- Optional last known coordinates (used as fallback; authoritative history is user_locations)
  last_lat DECIMAL(10,7) NULL,
  last_lng DECIMAL(10,7) NULL,
  -- Profile additions used at runtime
  bio TEXT NULL,
  avatar_url TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Helpful composite index for occasional geo searches when present
-- Guarded index creation (MySQL lacks IF NOT EXISTS for CREATE INDEX)
SET @has_idx := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_last_latlng'
);
SET @sql := IF(@has_idx = 0, 'CREATE INDEX idx_users_last_latlng ON users(last_lat,last_lng)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  token CHAR(64) NOT NULL UNIQUE,
  csrf_token CHAR(32) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Removed unused: email_verifications, password_resets, user_preferences

CREATE TABLE IF NOT EXISTS user_locations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lng DECIMAL(10,7) NOT NULL,
  captured_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(32) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_userloc_user_time (user_id, captured_at),
  INDEX idx_userloc_lat_lng (lat, lng)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_follows (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  follower_user_id BIGINT NOT NULL,
  followee_user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_follow (follower_user_id, followee_user_id),
  FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (followee_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============== Social Posts & Messaging ===============
CREATE TABLE IF NOT EXISTS posts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  author_id BIGINT NOT NULL,
  body TEXT,
  image_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_posts_author_created (author_id, created_at)
) ENGINE=InnoDB;

-- Removed unused: post_likes

CREATE TABLE IF NOT EXISTS post_comments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS post_shares (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  post_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  type VARCHAR(50) NOT NULL,
  payload JSON,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  read_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notif_user_created (user_id, created_at)
) ENGINE=InnoDB;

-- Removed unused: chat_messages (replaced by conversations/messages)

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  is_group TINYINT(1) NOT NULL DEFAULT 0,
  created_by_user_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_conversations_creator (created_by_user_id, created_at)

) ENGINE=InnoDB;

-- Define messages first so participants can reference last_read_message_id
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT NOT NULL,
  sender_user_id BIGINT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_messages_conversation (conversation_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS conversation_participants (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  conversation_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  last_read_message_id BIGINT NULL,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_conversation_user (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (last_read_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  INDEX idx_conv_part_user (user_id, conversation_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS api_metrics (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  path VARCHAR(255) NOT NULL,
  method VARCHAR(8) NOT NULL,
  status_code INT NOT NULL,
  duration_ms INT NOT NULL,
  user_id BIGINT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_metrics_created (created_at),
  INDEX idx_metrics_path (path),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NULL,
  path VARCHAR(255),
  method VARCHAR(8),
  status_code INT,
  meta JSON NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB;

-- Removed unused: nlp_alerts

-- =============== Healthcare & Appointments =============
CREATE TABLE IF NOT EXISTS hospitals (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS doctors (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  specialty VARCHAR(255),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
-- Map hospital accounts to doctor users
CREATE TABLE IF NOT EXISTS hospital_doctors (
  hospital_user_id BIGINT NOT NULL,
  doctor_user_id BIGINT NOT NULL,
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (hospital_user_id, doctor_user_id),
  FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Weekly recurring availability
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  doctor_user_id BIGINT NOT NULL,
  hospital_user_id BIGINT NOT NULL,
  weekday TINYINT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  visit_cost DECIMAL(10,2) NULL,
  max_per_day INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_doc_hosp_day (doctor_user_id, hospital_user_id, weekday),
  FOREIGN KEY (doctor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Appointment bookings
CREATE TABLE IF NOT EXISTS appointments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  patient_user_id BIGINT NOT NULL,
  doctor_user_id BIGINT NOT NULL,
  hospital_user_id BIGINT NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'booked', -- booked|cancelled|completed
  serial INT NULL,
  approx_time VARCHAR(20) NULL,
  hidden_by_patient TINYINT(1) DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_doc_time (doctor_user_id, starts_at),
  INDEX idx_patient (patient_user_id),
  INDEX idx_hospital (hospital_user_id),
  FOREIGN KEY (patient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Public services offered by a hospital
CREATE TABLE IF NOT EXISTS hospital_services (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  hospital_user_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  price DECIMAL(10,2) NOT NULL DEFAULT 0,
  duration_minutes INT NOT NULL DEFAULT 30,
  max_per_day INT NULL,
  window_start_time TIME NULL,
  window_end_time TIME NULL,
  available TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_hosp (hospital_user_id),
  FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Service bookings for non-doctor services
-- service_bookings moved after crises to allow FK on crisis_id

-- =============== Blood Bank & Donor Flow ===============
CREATE TABLE IF NOT EXISTS donor_profiles (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL UNIQUE,
  blood_type VARCHAR(5) NOT NULL,
  availability_text VARCHAR(255) NULL,
  last_donation_date DATE NULL,
  cooldown_until DATETIME NULL,
  availability_status VARCHAR(20) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_donor_blood_type (blood_type)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  hospital_user_id BIGINT NOT NULL,
  blood_type VARCHAR(8) NOT NULL,
  quantity_units INT NOT NULL,
  needed_by DATETIME NULL,
  notes TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_hospital (hospital_user_id),
  FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_direct_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  requester_user_id BIGINT NOT NULL,
  target_blood_type VARCHAR(5) NOT NULL,
  quantity_units INT NOT NULL DEFAULT 1,
  notes TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open', -- open|accepted|fulfilled|cancelled
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_bdr_blood_status (target_blood_type, status),
  INDEX idx_bdr_requester (requester_user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_direct_request_responses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  request_id BIGINT NOT NULL,
  donor_user_id BIGINT NOT NULL,
  message VARCHAR(500) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|accepted|declined|cancelled
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_request_donor (request_id, donor_user_id),
  FOREIGN KEY (request_id) REFERENCES blood_direct_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (donor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_bdr_resp_status (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_donor_recruit_posts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  owner_user_id BIGINT NOT NULL,
  blood_request_id BIGINT NULL,
  target_blood_type VARCHAR(8) NOT NULL,
  location_text VARCHAR(255) NULL,
  scheduled_at DATETIME NULL,
  notes TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blood_request_id) REFERENCES blood_requests(id) ON DELETE SET NULL,
    -- Adding missing column 'campaign_type'
    campaign_type VARCHAR(50) NULL,
  INDEX idx_owner (owner_user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_donor_applications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  recruit_post_id BIGINT NOT NULL,
  donor_user_id BIGINT NOT NULL,
  availability_at DATETIME NULL,
  notes TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_post_donor (recruit_post_id, donor_user_id),
  FOREIGN KEY (recruit_post_id) REFERENCES blood_donor_recruit_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (donor_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Blood bank internal management
CREATE TABLE IF NOT EXISTS blood_bank_staff (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  bank_user_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(120) NULL,
  phone VARCHAR(64) NULL,
  email VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bank (bank_user_id),
  FOREIGN KEY (bank_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_inventory (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  bank_user_id BIGINT NOT NULL,
  blood_type VARCHAR(8) NOT NULL,
  quantity_units INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_bank_bt (bank_user_id, blood_type),
  INDEX idx_bank (bank_user_id),
  FOREIGN KEY (bank_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_inventory_issuances (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  bank_user_id BIGINT NOT NULL,
  blood_type VARCHAR(8) NOT NULL,
  quantity_units INT NOT NULL,
  purpose TEXT NULL,
  issued_to_name VARCHAR(255) NULL,
  issued_to_contact VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'issued', -- issued|reverted
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bank (bank_user_id),
  FOREIGN KEY (bank_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_bank_donors (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  bank_user_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  blood_type VARCHAR(8) NOT NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_bank_user (bank_user_id, user_id),
  INDEX idx_bank (bank_user_id),
  FOREIGN KEY (bank_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_inventory_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  requester_user_id BIGINT NOT NULL,
  bank_user_id BIGINT NOT NULL,
  blood_type VARCHAR(8) NOT NULL,
  quantity_units INT NOT NULL,
  target_datetime DATETIME NOT NULL,
  location_text VARCHAR(255) NULL,
  crisis_id BIGINT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|accepted|rejected|cancelled|completed
  reject_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bank (bank_user_id),
  INDEX idx_requester (requester_user_id),
  FOREIGN KEY (bank_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS blood_donor_meeting_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  requester_user_id BIGINT NOT NULL,
  donor_user_id BIGINT NOT NULL,
  blood_type VARCHAR(8) NULL,
  target_datetime DATETIME NOT NULL,
  location_text VARCHAR(255) NULL,
  crisis_id BIGINT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|accepted|rejected|cancelled|completed
  cooldown_days_after_completion INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_donor (donor_user_id),
  INDEX idx_requester (requester_user_id),
  FOREIGN KEY (donor_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (requester_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============== Fire Service & Incidents ===============
CREATE TABLE IF NOT EXISTS fire_departments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_fire_dept_lat_lng (lat, lng)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fire_teams (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  department_id BIGINT NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'available',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_fire_teams_dept (department_id),
  FOREIGN KEY (department_id) REFERENCES fire_departments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fire_inventory (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  department_id BIGINT NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_fire_inventory_dept (department_id),
  FOREIGN KEY (department_id) REFERENCES fire_departments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Fire staff members linked to departments (used across views)
CREATE TABLE IF NOT EXISTS fire_staff (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  department_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role VARCHAR(64) NULL,
  display_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fire_staff (department_id, user_id),
  INDEX idx_department (department_id),
  INDEX idx_user (user_id),
  FOREIGN KEY (department_id) REFERENCES fire_departments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fire_team_members (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  team_id BIGINT NOT NULL,
  staff_id BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_staff (team_id, staff_id),
  INDEX idx_team_members_team (team_id),
  INDEX idx_team_members_staff (staff_id),
  FOREIGN KEY (team_id) REFERENCES fire_teams(id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES fire_staff(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fire_service_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  requester_id BIGINT NOT NULL,
  lat DECIMAL(10,7),
  lng DECIMAL(10,7),
  description TEXT,
  status ENUM('pending','assigned','resolved','cancelled','completed') DEFAULT 'pending',
  assigned_department_id BIGINT NULL,
  assigned_team_id BIGINT NULL,
  assigned_team_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_fsr_lat_lng (lat, lng),
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_department_id) REFERENCES fire_departments(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_team_id) REFERENCES fire_teams(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fire_request_candidates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  request_id BIGINT NOT NULL,
  department_id BIGINT NOT NULL,
  candidate_rank INT NOT NULL DEFAULT 1,
  status VARCHAR(16) NOT NULL DEFAULT 'pending', -- pending|accepted|declined|expired
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_req_dept (request_id, department_id),
  INDEX idx_frc_request_status (request_id, status),
  INDEX idx_frc_department_status (department_id, status),
  FOREIGN KEY (request_id) REFERENCES fire_service_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES fire_departments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fire_request_user_hides (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  request_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_hide (request_id, user_id),
  FOREIGN KEY (request_id) REFERENCES fire_service_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Incidents (general emergency management)
CREATE TABLE IF NOT EXISTS incidents (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  creator_user_id BIGINT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  -- Classification and coordinates for crisis-scoped features
  incident_type VARCHAR(64) NULL,
  severity VARCHAR(32) NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  -- Timestamps used widely by API code
  opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Helpful index for listing/filtering incidents by status and opened time
SET @has_inc_idx := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND INDEX_NAME = 'idx_incident_status'
);
SET @sql_inc_idx := IF(@has_inc_idx = 0, 'CREATE INDEX idx_incident_status ON incidents(status, opened_at)', 'SELECT 1');
PREPARE stmt_inc FROM @sql_inc_idx; EXECUTE stmt_inc; DEALLOCATE PREPARE stmt_inc;

CREATE TABLE IF NOT EXISTS incident_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  incident_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ie_inc (incident_id, created_at),
  INDEX idx_ie_user (user_id, created_at),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incident_participants (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  incident_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role_label VARCHAR(64) NULL,
  status VARCHAR(32) NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incident_hospital_resources (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  incident_id BIGINT NOT NULL,
  hospital_user_id BIGINT NOT NULL,
  available_beds INT NULL,
  doctors TEXT NULL,
  services TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_incident_hospital (incident_id, hospital_user_id),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============== Social Organizations (moved earlier for FK order) ======
CREATE TABLE IF NOT EXISTS social_organizations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incident_social_deployments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  incident_id BIGINT NOT NULL,
  org_id BIGINT NOT NULL,
  deployed_by_user_id BIGINT NOT NULL,
  headcount INT NOT NULL,
  capabilities TEXT NULL,
  note TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_isd_incident (incident_id),
  INDEX idx_isd_org (org_id),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (org_id) REFERENCES social_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (deployed_by_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incident_social_deployment_members (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  deployment_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role_label VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY idx_isdm_dep_user (deployment_id, user_id),
  INDEX idx_isdm_dep (deployment_id),
  INDEX idx_isdm_user (user_id),
  FOREIGN KEY (deployment_id) REFERENCES incident_social_deployments(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS incident_team_deployments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  incident_id BIGINT NOT NULL,
  department_id BIGINT NOT NULL,
  team_id BIGINT NOT NULL,
  deployed_by_user_id BIGINT NOT NULL,
  note TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_itd_incident (incident_id),
  INDEX idx_itd_team (team_id),
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES fire_teams(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES fire_departments(id) ON DELETE CASCADE,
  FOREIGN KEY (deployed_by_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============== Campaigns ======

CREATE TABLE IF NOT EXISTS campaigns (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  owner_user_id BIGINT NOT NULL, -- supersedes social_org_user_id
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  location_text VARCHAR(255) NULL,
  target_metric VARCHAR(50) NULL,
  target_value INT NULL,
  current_value INT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_campaigns_start (starts_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campaign_participants (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  campaign_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role_label VARCHAR(50) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'accepted',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_campaign_user (campaign_id, user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS social_org_volunteers (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  org_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role_label VARCHAR(64) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_user (org_id, user_id),
  INDEX idx_org (org_id),
  INDEX idx_user (user_id),
  FOREIGN KEY (org_id) REFERENCES social_organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campaign_donations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  campaign_id BIGINT NOT NULL,
  donor_user_id BIGINT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'BDT',
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_camp (campaign_id),
  INDEX idx_camp_id (campaign_id, id),
  INDEX idx_donor (donor_user_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (donor_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campaign_expenses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  campaign_id BIGINT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'BDT',
  category VARCHAR(64) NULL,
  description TEXT,
  spent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_user_id BIGINT NOT NULL,
  INDEX idx_camp (campaign_id),
  INDEX idx_camp_id (campaign_id, id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =============== Crisis Management =====================
CREATE TABLE IF NOT EXISTS crises (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  incident_id BIGINT NULL,
  admin_user_id BIGINT NOT NULL,
  radius_km DECIMAL(6,2) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (incident_id) REFERENCES incidents(id) ON DELETE CASCADE,
  FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crisis_invitations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  crisis_id BIGINT NOT NULL,
  org_user_id BIGINT NOT NULL,
  org_type VARCHAR(50) NULL,
  note TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME NULL,
  UNIQUE KEY uq_crisis_invitee (crisis_id, org_user_id),
  FOREIGN KEY (crisis_id) REFERENCES crises(id) ON DELETE CASCADE,
  FOREIGN KEY (org_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crisis_donations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  crisis_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  note TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_crisis (crisis_id, id),
  FOREIGN KEY (crisis_id) REFERENCES crises(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crisis_expenses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  crisis_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  purpose TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_crisis (crisis_id, id),
  FOREIGN KEY (crisis_id) REFERENCES crises(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crisis_victims (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  crisis_id BIGINT NOT NULL,
  user_id BIGINT NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  status VARCHAR(32) NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rescue_status VARCHAR(50) NULL,
  UNIQUE KEY uq_crisis_victim (crisis_id, user_id),
  FOREIGN KEY (crisis_id) REFERENCES crises(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crisis_blood_donors (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  crisis_id BIGINT NOT NULL,
  bank_user_id BIGINT NOT NULL,
  donor_user_id BIGINT NOT NULL,
  blood_type VARCHAR(5) NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crisis_donor (crisis_id, bank_user_id, donor_user_id),
  FOREIGN KEY (crisis_id) REFERENCES crises(id) ON DELETE CASCADE,
  FOREIGN KEY (bank_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (donor_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crisis_blood_allocations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  crisis_id BIGINT NOT NULL,
  bank_user_id BIGINT NOT NULL,
  blood_type VARCHAR(5) NOT NULL,
  quantity_units INT NOT NULL,
  purpose TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'allocated',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (crisis_id) REFERENCES crises(id) ON DELETE CASCADE,
  FOREIGN KEY (bank_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS crisis_participation_requests (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  crisis_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role_label VARCHAR(50) NULL,
  note VARCHAR(255) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  decided_by_user_id BIGINT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crisis_request (crisis_id, user_id),
  FOREIGN KEY (crisis_id) REFERENCES crises(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Now that crises is defined, create service_bookings with FK to crises
CREATE TABLE IF NOT EXISTS service_bookings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  hospital_user_id BIGINT NOT NULL,
  service_id BIGINT NOT NULL,
  scheduled_at DATETIME NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'booked',
  serial INT NULL,
  approx_time VARCHAR(32) NULL,
  notes TEXT NULL,
  lat DECIMAL(10,6) NULL,
  lng DECIMAL(10,6) NULL,
  crisis_id BIGINT NULL,
  hidden_by_user TINYINT(1) DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_hosp (hospital_user_id),
  INDEX idx_service (service_id),
  INDEX idx_crisis (crisis_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (hospital_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (service_id) REFERENCES hospital_services(id) ON DELETE CASCADE,
  FOREIGN KEY (crisis_id) REFERENCES crises(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- =============== Rate Limiting =========================
CREATE TABLE IF NOT EXISTS rate_limits (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  scope_key VARCHAR(255) NOT NULL,
  window_started_at DATETIME NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  last_hit_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rate (scope_key, window_started_at),
  INDEX idx_rate_limits_last_hit (last_hit_at)
) ENGINE=InnoDB;

-- =============== Legacy Event Tables (Optional) =========
-- Kept for backward compatibility if any code paths still use them.
CREATE TABLE IF NOT EXISTS emergency_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  admin_id BIGINT NOT NULL,
  type VARCHAR(32),
  title VARCHAR(255),
  description TEXT,
  status VARCHAR(32),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Removed unused: event_resources, victims, event_participants
