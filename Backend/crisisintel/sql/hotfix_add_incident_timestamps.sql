-- Hotfix: align incidents table with API code expectations
-- Adds opened_at, updated_at, closed_at and an index if missing.

USE crisisintel;

-- Add opened_at if missing
SET @has_opened := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'opened_at'
);
SET @sql_opened := IF(@has_opened = 0, 'ALTER TABLE incidents ADD COLUMN opened_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER status', 'SELECT 1');
PREPARE stmt1 FROM @sql_opened; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

-- Add updated_at if missing
SET @has_updated := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'updated_at'
);
SET @sql_updated := IF(@has_updated = 0, 'ALTER TABLE incidents ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER opened_at', 'SELECT 1');
PREPARE stmt2 FROM @sql_updated; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- Add closed_at if missing
SET @has_closed := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND COLUMN_NAME = 'closed_at'
);
SET @sql_closed := IF(@has_closed = 0, 'ALTER TABLE incidents ADD COLUMN closed_at DATETIME NULL AFTER updated_at', 'SELECT 1');
PREPARE stmt3 FROM @sql_closed; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;

-- Create index if missing
SET @has_idx := (
  SELECT COUNT(1) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incidents' AND INDEX_NAME = 'idx_incident_status'
);
SET @sql_idx := IF(@has_idx = 0, 'CREATE INDEX idx_incident_status ON incidents(status, opened_at)', 'SELECT 1');
PREPARE stmt4 FROM @sql_idx; EXECUTE stmt4; DEALLOCATE PREPARE stmt4;

-- Backfill opened_at/updated_at from created_at if they are NULL (defensive)
UPDATE incidents SET opened_at = COALESCE(opened_at, created_at), updated_at = COALESCE(updated_at, created_at) WHERE 1=1;
