-- Recurring work, rebuilt for Project › Task › Subtask.
--
-- * recurring_tasks becomes a rule: a task blueprint plus a schedule
--   (every working day; weekly on chosen days, every N weeks; monthly on a
--   day or the last day, every N months), with start/end dates and a due
--   offset. Anyone on a project may propose one; an admin approves it the
--   first time and decides then whether each copy needs review.
--   project_id may be NULL while a proposal asks for a new project of its
--   own (new_project_name); approving it creates that project.
-- * recurring_subtasks: the subtasks every copy starts with.
-- * recurring_skips: dates a rule did not make a copy, and why (holiday,
--   day off, last copy still open, missed while the server was down, or
--   skipped by hand) — the rule's history, and how "skip next" is stored.
-- * tasks.recurring_task_id / occurrence_date link a copy to its rule and
--   date; the unique key means a date can never be created twice. (No
--   foreign key: schema.sql creates tasks before recurring_tasks. Ending a
--   rule unlinks its copies in code, lib/recurring.ts.)
--   tasks.auto_approve marks copies of a rule that needs no review: marking
--   them complete finishes and signs them off at once.
--
-- Existing rules keep working as before: they are approved, need review,
-- and keep their weekday (weekly) or day of the month (monthly).
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-11-05_recurring_work.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'recurring_tasks' AND column_name = 'approval_status'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE recurring_tasks
     MODIFY COLUMN project_id INT NULL,
     ADD COLUMN new_project_name VARCHAR(200) NULL AFTER project_id,
     ADD COLUMN interval_n      TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER recurrence,
     ADD COLUMN weekdays        VARCHAR(27) NULL AFTER interval_n,
     ADD COLUMN month_day       TINYINT NULL AFTER weekdays,
     ADD COLUMN start_date      DATE NULL AFTER month_day,
     ADD COLUMN end_date        DATE NULL AFTER start_date,
     ADD COLUMN due_after_days  TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER end_date,
     ADD COLUMN when_open       ENUM(''skip'',''create'') NOT NULL DEFAULT ''skip'' AFTER due_after_days,
     ADD COLUMN review_mode     ENUM(''review'',''none'') NULL AFTER when_open,
     ADD COLUMN approval_status ENUM(''pending'',''approved'',''rejected'') NOT NULL DEFAULT ''approved'' AFTER review_mode,
     ADD COLUMN decided_by      INT NULL AFTER approval_status,
     ADD COLUMN decided_at      DATETIME NULL AFTER decided_by,
     ADD COLUMN decision_note   VARCHAR(500) NULL AFTER decided_at,
     ADD COLUMN paused_reason   VARCHAR(200) NULL AFTER is_active,
     ADD COLUMN last_run        DATE NULL AFTER next_run,
     ADD COLUMN updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
     ADD INDEX idx_rt_approval (approval_status)',
  'SELECT ''recurring_tasks already a rule'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Rules made before this migration: approved, reviewed as before, on the
-- weekday / day of the month of their next run.
UPDATE recurring_tasks
   SET start_date = next_run,
       last_run = DATE_SUB(next_run, INTERVAL 1 DAY),
       review_mode = COALESCE(review_mode, 'review'),
       weekdays = IF(recurrence = 'weekly', DATE_FORMAT(next_run, '%a'), weekdays),
       month_day = IF(recurrence = 'monthly', DAY(next_run), month_day)
 WHERE start_date IS NULL;

CREATE TABLE IF NOT EXISTS recurring_subtasks (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  recurring_task_id INT NOT NULL,
  title             VARCHAR(200) NOT NULL,
  assignee_id       INT NULL,
  position          INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_rs_rule     FOREIGN KEY (recurring_task_id) REFERENCES recurring_tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_rs_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_rs_rule (recurring_task_id, position)
);

CREATE TABLE IF NOT EXISTS recurring_skips (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  recurring_task_id INT NOT NULL,
  occurrence_date   DATE NOT NULL,
  reason            ENUM('holiday','day_off','still_open','missed','skipped') NOT NULL,
  moved_to          DATE NULL,
  created_by        INT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rsk_rule FOREIGN KEY (recurring_task_id) REFERENCES recurring_tasks(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rsk (recurring_task_id, occurrence_date)
);

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tasks' AND column_name = 'recurring_task_id'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE tasks
     ADD COLUMN recurring_task_id INT NULL AFTER parent_task_id,
     ADD COLUMN occurrence_date   DATE NULL AFTER recurring_task_id,
     ADD COLUMN auto_approve      TINYINT(1) NOT NULL DEFAULT 0 AFTER occurrence_date,
     ADD UNIQUE KEY uq_tasks_occurrence (recurring_task_id, occurrence_date)',
  'SELECT ''tasks.recurring_task_id already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
