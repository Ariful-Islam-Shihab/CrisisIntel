-- Normalize column names and tables to match code usage, idempotently

-- incidents: rename created_by_user_id -> creator_user_id if needed
SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='incidents' AND COLUMN_NAME='created_by_user_id'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE incidents CHANGE COLUMN created_by_user_id creator_user_id BIGINT NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- incident_participants: add joined_at if missing (used in list_incident_participants)
SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='incident_participants' AND COLUMN_NAME='joined_at'
);
SET @sql := IF(@exists = 0, 'ALTER TABLE incident_participants ADD COLUMN joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- crises: ensure columns are (incident_id, admin_user_id, radius_km, created_at, updated_at)
-- Drop legacy owner_user_id/title/description/status/severity_level/lat/lng if present
-- Add/rename admin_user_id; add timestamps
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='owner_user_id');
SET @sql := IF(@exists = 1, 'ALTER TABLE crises CHANGE COLUMN owner_user_id admin_user_id BIGINT NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='title');
SET @sql := IF(@exists = 1, 'ALTER TABLE crises DROP COLUMN title', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='description');
SET @sql := IF(@exists = 1, 'ALTER TABLE crises DROP COLUMN description', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='status');
SET @sql := IF(@exists = 1, 'ALTER TABLE crises DROP COLUMN status', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='severity_level');
SET @sql := IF(@exists = 1, 'ALTER TABLE crises DROP COLUMN severity_level', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='lat');
SET @sql := IF(@exists = 1, 'ALTER TABLE crises DROP COLUMN lat', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='lng');
SET @sql := IF(@exists = 1, 'ALTER TABLE crises DROP COLUMN lng', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Ensure admin_user_id exists if crises table created without it
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='admin_user_id');
SET @sql := IF(@exists = 0, 'ALTER TABLE crises ADD COLUMN admin_user_id BIGINT NOT NULL AFTER incident_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Ensure radius_km exists
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='radius_km');
SET @sql := IF(@exists = 0, 'ALTER TABLE crises ADD COLUMN radius_km DECIMAL(6,2) NULL AFTER admin_user_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Ensure created_at/updated_at exist
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='created_at');
SET @sql := IF(@exists = 0, 'ALTER TABLE crises ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND COLUMN_NAME='updated_at');
SET @sql := IF(@exists = 0, 'ALTER TABLE crises ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Foreign keys for crises
-- Ensure FK to incidents
SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND REFERENCED_TABLE_NAME='incidents' AND COLUMN_NAME='incident_id'
);
-- MySQL cannot add duplicate FK with same name easily; rely on presence check
-- Ensure FK to users for admin_user_id
SET @exists2 := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crises' AND REFERENCED_TABLE_NAME='users' AND COLUMN_NAME='admin_user_id'
);
-- If needed, you can add specific FK names here in future.
