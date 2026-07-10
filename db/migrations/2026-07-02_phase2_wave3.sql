-- Phase 2 · Wave 3 — Additional / follow-up works (#7).
-- A task can be flagged as "additional" (extra work raised after a task or
-- project was completed) and optionally linked to the task it follows up.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-02_phase2_wave3.sql

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tasks'
    AND column_name = 'is_additional'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE tasks
     ADD COLUMN is_additional  TINYINT(1) NOT NULL DEFAULT 0 AFTER due_alert_sent,
     ADD COLUMN parent_task_id INT NULL AFTER is_additional,
     ADD CONSTRAINT fk_tasks_parent FOREIGN KEY (parent_task_id)
         REFERENCES tasks(id) ON DELETE SET NULL,
     ADD INDEX idx_tasks_parent (parent_task_id)',
  'SELECT "tasks.is_additional already exists — skipping"');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
