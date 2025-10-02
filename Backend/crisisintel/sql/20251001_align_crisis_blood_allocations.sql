-- Align crisis_blood_allocations columns to match API implementation

-- If old columns exist, adjust to new design
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='donor_user_id');
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_blood_allocations DROP COLUMN donor_user_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='recipient_user_id');
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_blood_allocations DROP COLUMN recipient_user_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='units');
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_blood_allocations CHANGE COLUMN units quantity_units INT NOT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Ensure required columns exist
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='bank_user_id');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_blood_allocations ADD COLUMN bank_user_id BIGINT NOT NULL AFTER crisis_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='purpose');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_blood_allocations ADD COLUMN purpose TEXT NULL AFTER quantity_units', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_allocations' AND COLUMN_NAME='status');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_blood_allocations ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT "allocated" AFTER purpose', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add FKs if missing (best-effort)
-- bank_user_id -> users(id)
-- crisis_id -> crises(id) should already exist per base schema
