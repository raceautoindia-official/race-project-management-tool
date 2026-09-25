-- The person asking for work says how urgent it is and how long it should
-- take. Until now those were invented by whoever approved the request, who is
-- usually further from the work than the person who asked for it.
--
-- Existing rows get the same defaults a task gets, so nothing changes for
-- requests already raised.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-09-25_request_priority_and_time.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_requests'
    AND column_name = 'priority'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE task_requests
     ADD COLUMN priority ENUM(''low'',''medium'',''high'',''urgent'')
       NOT NULL DEFAULT ''medium'' AFTER rules,
     ADD COLUMN estimated_hours DECIMAL(6,2) NULL AFTER priority,
     ADD COLUMN due_date DATE NULL AFTER estimated_hours',
  'SELECT ''task_requests already carries priority, estimated_hours and due_date'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
