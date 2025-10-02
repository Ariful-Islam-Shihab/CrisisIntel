-- Adjust schema to align with backend expectations for requests feed and victim location
-- Safe conditional alterations using INFORMATION_SCHEMA checks and dynamic SQL

-- users: add last_lat/last_lng
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_lat');
SET @sql := IF(@exists = 0, 'ALTER TABLE users ADD COLUMN last_lat DECIMAL(10,7) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='last_lng');
SET @sql := IF(@exists = 0, 'ALTER TABLE users ADD COLUMN last_lng DECIMAL(10,7) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- users: composite index if missing
SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND INDEX_NAME='idx_users_last_latlng'
);
SET @sql := IF(@exists = 0, 'CREATE INDEX idx_users_last_latlng ON users(last_lat,last_lng)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- incidents: add type/severity/lat/lng
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='incidents' AND COLUMN_NAME='incident_type');
SET @sql := IF(@exists = 0, 'ALTER TABLE incidents ADD COLUMN incident_type VARCHAR(64) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='incidents' AND COLUMN_NAME='severity');
SET @sql := IF(@exists = 0, 'ALTER TABLE incidents ADD COLUMN severity VARCHAR(32) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='incidents' AND COLUMN_NAME='lat');
SET @sql := IF(@exists = 0, 'ALTER TABLE incidents ADD COLUMN lat DECIMAL(10,7) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='incidents' AND COLUMN_NAME='lng');
SET @sql := IF(@exists = 0, 'ALTER TABLE incidents ADD COLUMN lng DECIMAL(10,7) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- incident_participants: rename role -> role_label
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='incident_participants' AND COLUMN_NAME='role');
SET @sql := IF(@exists = 1, 'ALTER TABLE incident_participants CHANGE COLUMN role role_label VARCHAR(64) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- crises: link to incident + lat/lng/radius
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='incident_id');
SET @sql := IF(@exists = 0, 'ALTER TABLE crises ADD COLUMN incident_id BIGINT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='lat');
SET @sql := IF(@exists = 0, 'ALTER TABLE crises ADD COLUMN lat DECIMAL(10,7) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='lng');
SET @sql := IF(@exists = 0, 'ALTER TABLE crises ADD COLUMN lng DECIMAL(10,7) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='radius_km');
SET @sql := IF(@exists = 0, 'ALTER TABLE crises ADD COLUMN radius_km DECIMAL(6,2) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- crisis_invitations: migrate legacy columns to new structure
-- rename invitee_user_id -> org_user_id
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_invitations' AND COLUMN_NAME='invitee_user_id');
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_invitations CHANGE COLUMN invitee_user_id org_user_id BIGINT NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- rename role -> org_type
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_invitations' AND COLUMN_NAME='role');
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_invitations CHANGE COLUMN role org_type VARCHAR(50) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- add note
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_invitations' AND COLUMN_NAME='note');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_invitations ADD COLUMN note TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- add responded_at
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_invitations' AND COLUMN_NAME='responded_at');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_invitations ADD COLUMN responded_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- ensure unique key on (crisis_id, org_user_id)
-- drop old unique if it targets invitee_user_id
SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_invitations' AND INDEX_NAME='uq_crisis_invitee' AND COLUMN_NAME='invitee_user_id'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_invitations DROP INDEX uq_crisis_invitee', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_invitations' AND INDEX_NAME='uq_crisis_invitee'
);
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_invitations ADD UNIQUE KEY uq_crisis_invitee (crisis_id, org_user_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- crisis_victims: add note
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_victims' AND COLUMN_NAME='note');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_victims ADD COLUMN note VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- crisis_participation_requests: migrate columns
-- rename role -> role_label
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_participation_requests' AND COLUMN_NAME='role');
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_participation_requests CHANGE COLUMN role role_label VARCHAR(50) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- add note
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_participation_requests' AND COLUMN_NAME='note');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_participation_requests ADD COLUMN note VARCHAR(255) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- add decided_by_user_id
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_participation_requests' AND COLUMN_NAME='decided_by_user_id');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_participation_requests ADD COLUMN decided_by_user_id BIGINT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- add updated_at
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_participation_requests' AND COLUMN_NAME='updated_at');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_participation_requests ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- add FK for decided_by_user_id if not exists (best-effort; may fail if name conflict)
SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_participation_requests' AND COLUMN_NAME='decided_by_user_id' AND REFERENCED_TABLE_NAME='users'
);
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_participation_requests ADD CONSTRAINT fk_cpr_decided_by FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE SET NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
