-- Phase 2 · Wave 1 — Hour-based work assignment (#1)
-- Adds an estimate (set by admin/project lead) and a running actual-hours
-- tally (logged by the assignee) to each task.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-02_phase2_task_hours.sql
-- Idempotent-ish: guarded so re-running is safe on MySQL 8.

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tasks'
    AND column_name = 'estimated_hours'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE tasks
     ADD COLUMN estimated_hours DECIMAL(6,2) NULL AFTER priority,
     ADD COLUMN spent_hours     DECIMAL(6,2) NOT NULL DEFAULT 0 AFTER estimated_hours',
  'SELECT "tasks.estimated_hours already exists — skipping"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
