-- Phase 3 · Wave 8 — per-user performance tracking.
-- Adds tasks.completed_at (when the task was actually marked Done) so on-time
-- vs late completion can be computed. Backfills from approved_at for tasks
-- already done.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-14_phase3_wave8.sql

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tasks'
    AND column_name = 'completed_at'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE tasks
     ADD COLUMN completed_at DATETIME NULL AFTER approved_at,
     ADD INDEX idx_tasks_completed (completed_at)',
  'SELECT "tasks.completed_at already exists — skipping"');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE tasks
   SET completed_at = COALESCE(approved_at, updated_at)
 WHERE status = 'done' AND completed_at IS NULL;
