-- Drop all tables in the current database schema safely (equivalent to recreating a fresh DB)
-- This avoids requiring server-level privileges to DROP/CREATE DATABASE while achieving a clean slate.

SET SESSION group_concat_max_len = 1000000;
SET @tables := (
  SELECT GROUP_CONCAT(CONCAT('`', table_name, '`') SEPARATOR ', ')
  FROM information_schema.tables
  WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> 'schema_migrations'
);

SET FOREIGN_KEY_CHECKS=0;
SET @drop := IF(@tables IS NOT NULL, CONCAT('DROP TABLE ', @tables), 'SELECT 1');
PREPARE stmt FROM @drop; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET FOREIGN_KEY_CHECKS=1;
