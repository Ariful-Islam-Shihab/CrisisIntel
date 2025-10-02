-- Align crisis_blood_donors to match code usage (bank_user_id, blood_type, notes, unique key)

-- Add bank_user_id if missing
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_donors' AND COLUMN_NAME='bank_user_id');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_blood_donors ADD COLUMN bank_user_id BIGINT NOT NULL AFTER crisis_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add blood_type if missing
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_donors' AND COLUMN_NAME='blood_type');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_blood_donors ADD COLUMN blood_type VARCHAR(5) NOT NULL AFTER donor_user_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add notes if missing
SET @exists := (SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_donors' AND COLUMN_NAME='notes');
SET @sql := IF(@exists = 0, 'ALTER TABLE crisis_blood_donors ADD COLUMN notes TEXT NULL AFTER blood_type', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Adjust unique key to (crisis_id, bank_user_id, donor_user_id)
SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='crisis_blood_donors' AND INDEX_NAME='uq_crisis_donor'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE crisis_blood_donors DROP INDEX uq_crisis_donor', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @sql := 'ALTER TABLE crisis_blood_donors ADD UNIQUE KEY uq_crisis_donor (crisis_id, bank_user_id, donor_user_id)';
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
