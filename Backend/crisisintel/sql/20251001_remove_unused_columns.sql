-- Idempotent cleanup: remove unused columns not part of the intended design.
-- 1) conversations.severity_level should not exist.

-- Drop conversations.severity_level if present
SET @exists := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='conversations' AND COLUMN_NAME='severity_level'
);
SET @sql := IF(@exists = 1, 'ALTER TABLE conversations DROP COLUMN severity_level', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Note: incidents table is actively used across the codebase (creation, listing, joining,
-- crisis linkage). We will NOT drop incidents or its columns here.
-- If later we decide to trim incident fields, do it in a separate migration once code is updated.
