-- A blocker is raised by whoever is stuck, and approved by a lead.
--
-- "Blocked by" used to be a lead-only setting, which meant the one person who
-- knew the work was stuck — the one doing it — could not say so. Members now
-- raise a blocker with a reason; it waits for a lead's decision before it
-- counts. Rows that already exist were added by leads, so they are approved.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-09-30_blocker_requests.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_dependencies'
    AND column_name = 'status'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE task_dependencies
     ADD COLUMN status ENUM(''pending'',''approved'') NOT NULL DEFAULT ''approved''
       AFTER depends_on_task_id,
     ADD COLUMN reason VARCHAR(500) NULL AFTER status,
     ADD COLUMN requested_by INT NULL AFTER reason,
     ADD COLUMN decided_by INT NULL AFTER requested_by,
     ADD COLUMN decided_at DATETIME NULL AFTER decided_by,
     ADD INDEX idx_dep_status (status),
     ADD CONSTRAINT fk_dep_requester FOREIGN KEY (requested_by)
       REFERENCES users(id) ON DELETE SET NULL,
     ADD CONSTRAINT fk_dep_decider FOREIGN KEY (decided_by)
       REFERENCES users(id) ON DELETE SET NULL',
  'SELECT ''task_dependencies already has the approval columns'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
