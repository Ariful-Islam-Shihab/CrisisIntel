-- Optional cleanup for unused columns/tables.
-- IMPORTANT: This script now only drops objects that are not referenced by the app.
-- Double-check before running in production. Idempotent guards are included for MySQL.

USE crisisintel;

-- Temporarily disable FK checks to avoid drop ordering issues (we still drop in safe order)
SET @old_fk := @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

-- Optional: Drop legacy snapshot/UI columns on users (app tolerates absence via guards)
SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_lat'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE users DROP COLUMN last_lat', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'last_lng'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE users DROP COLUMN last_lng', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'ui_theme'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE users DROP COLUMN ui_theme', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'ui_contrast'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE users DROP COLUMN ui_contrast', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'ui_reduced_motion'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE users DROP COLUMN ui_reduced_motion', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'ui_font_scale'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE users DROP COLUMN ui_font_scale', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_verified'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE users DROP COLUMN email_verified', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop whole tables not used by app
-- Keep: notifications, audit_logs, campaigns, fire_* tables, appointments, blood_requests,
--       fire_service_requests, social_organizations, blood_donor_applications, emergency_events
--       because they are referenced by the backend.

SET @tbl := 'user_preferences';
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl);
SET @sql := IF(@exists = 1, CONCAT('DROP TABLE ', @tbl), 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @tbl := 'post_likes';
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl);
SET @sql := IF(@exists = 1, CONCAT('DROP TABLE ', @tbl), 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- chat_messages is not used; safe to drop
SET @tbl := 'chat_messages';
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl);
SET @sql := IF(@exists = 1, CONCAT('DROP TABLE ', @tbl), 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- nlp_alerts is not used; safe to drop
SET @tbl := 'nlp_alerts';
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl);
SET @sql := IF(@exists = 1, CONCAT('DROP TABLE ', @tbl), 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- domain-specific tables: KEEP emergency_events cluster (app uses minimal events endpoints)
-- If you truly don't need legacy events, you may uncomment the following block to drop them.
-- WARNING: The backend references emergency_events for create/list; dropping will break those endpoints.
--
-- SET @tbl := 'event_resources'; SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl); SET @sql := IF(@exists = 1, CONCAT('DROP TABLE ', @tbl), 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- SET @tbl := 'victims'; SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl); SET @sql := IF(@exists = 1, CONCAT('DROP TABLE ', @tbl), 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- SET @tbl := 'event_participants'; SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl); SET @sql := IF(@exists = 1, CONCAT('DROP TABLE ', @tbl), 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- SET @tbl := 'emergency_events'; SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl); SET @sql := IF(@exists = 1, CONCAT('DROP TABLE ', @tbl), 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- KEEP fire departments cluster (app references fire_departments and related flows)

-- KEEP appointments (app uses them). Drop an unused legacy variant if present
SET @tbl := 'doctor_hospital_schedule'; SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl); SET @sql := IF(@exists = 1, CONCAT('DROP TABLE ', @tbl), 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- KEEP the following (all used by the app): blood_requests, fire_service_requests,
-- social_organizations, blood_donor_applications.
-- Drop old alias table if present
SET @tbl := 'blood_recruit_posts'; SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl); SET @sql := IF(@exists = 1, CONCAT('DROP TABLE ', @tbl), 'SELECT 1'); PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Re-enable FK checks
SET FOREIGN_KEY_CHECKS = @old_fk;
