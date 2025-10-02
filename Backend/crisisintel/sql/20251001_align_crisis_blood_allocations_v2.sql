-- Robust alignment for crisis_blood_allocations: drop FKs on donor/recipient, change columns to bank_user_id/quantity_units/purpose/status

-- Drop FK on donor_user_id if any
SET @fk_name := (
  SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crisis_blood_allocations' AND COLUMN_NAME = 'donor_user_id' AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @sql := IF(@fk_name IS NOT NULL, CONCAT('ALTER TABLE crisis_blood_allocations DROP FOREIGN KEY `', @fk_name, '`'), 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Drop FK on recipient_user_id if any
SET @fk_name := (
  SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crisis_blood_allocations' AND COLUMN_NAME = 'recipient_user_id' AND REFERENCED_TABLE_NAME IS NOT NULL
  LIMIT 1
);
SET @sql := IF(@fk_name IS NOT NULL, CONCAT('ALTER TABLE crisis_blood_allocations DROP FOREIGN KEY `', @fk_name, '`'), 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Now drop columns if present
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='donor_user_id');
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_blood_allocations DROP COLUMN donor_user_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='recipient_user_id');
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_blood_allocations DROP COLUMN recipient_user_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Rename units -> quantity_units
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='units');
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_blood_allocations CHANGE COLUMN units quantity_units INT NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add bank_user_id if missing
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='bank_user_id');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_blood_allocations ADD COLUMN bank_user_id BIGINT NOT NULL AFTER crisis_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add purpose if missing
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='purpose');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_blood_allocations ADD COLUMN purpose TEXT NULL AFTER quantity_units', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add status if missing
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='status');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_blood_allocations ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT "allocated" AFTER purpose', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add FK bank_user_id -> users(id) if not present (best-effort)
SET @fk_missing := (
  SELECT COUNT(1)=0 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='bank_user_id' AND REFERENCED_TABLE_NAME='users'
);
SET @sql := IF(@fk_missing, 'ALTER TABLE crisis_blood_allocations ADD CONSTRAINT fk_cba_bank_user FOREIGN KEY (bank_user_id) REFERENCES users(id) ON DELETE CASCADE', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
