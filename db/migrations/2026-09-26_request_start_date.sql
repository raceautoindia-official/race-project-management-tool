-- A request says when work can start as well as when it is needed by, so the
-- person asking gives a range rather than a single deadline.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-09-26_request_start_date.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_requests'
    AND column_name = 'start_date'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE task_requests ADD COLUMN start_date DATE NULL AFTER estimated_hours',
  'SELECT ''task_requests.start_date already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
