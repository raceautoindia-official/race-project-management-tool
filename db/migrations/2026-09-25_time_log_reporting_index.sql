-- An index for reading time logs by person and date.
--
-- task_time_logs was only ever read one task at a time, so it carries an
-- index on task_id alone. The work-hours report asks the opposite question —
-- "what did this person log last week" — which without this scans the whole
-- table on every page load.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-09-25_time_log_reporting_index.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'task_time_logs'
    AND index_name = 'idx_ttl_user_logged'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE task_time_logs ADD INDEX idx_ttl_user_logged (user_id, logged_at)',
  'SELECT ''idx_ttl_user_logged already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
