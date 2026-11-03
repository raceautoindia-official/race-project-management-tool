-- Work timer, tied to the Attendance clock.
--
-- Starting work on a task or subtask now runs a timer, and only someone
-- clocked in on the Attendance app can start one. Clocking out there pauses
-- it at the clock-out time. Each stretch of work is a work_session; when it
-- ends, its minutes are written to task_time_logs (source 'timer'), so every
-- report that already reads logged time picks it up unchanged.
--
-- * work_sessions: one row per stretch of work. ended_at NULL = running.
--   open_user is the user while the session runs and NULL after, so the
--   unique key allows one running timer per person, whoever starts it.
--   (No foreign key on user_id or ended_at: MySQL forbids cascading keys on
--   the columns a stored generated column is built from. People are retired,
--   never deleted.)
-- * task_time_logs.source: 'manual' (typed in) or 'timer'; session_id and
--   subtask_id say which stretch of work and which subtask it came from.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-31_work_timer.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS work_sessions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  task_id     INT NOT NULL,
  subtask_id  INT NULL,
  started_at  DATETIME NOT NULL,
  ended_at    DATETIME NULL,
  end_reason  ENUM('paused','switched','clocked_out','finished','retired') NULL,
  minutes     INT NULL,
  open_user   INT AS (IF(ended_at IS NULL, user_id, NULL)) STORED,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ws_open_user (open_user),
  CONSTRAINT fk_ws_task    FOREIGN KEY (task_id)    REFERENCES tasks(id)    ON DELETE CASCADE,
  CONSTRAINT fk_ws_subtask FOREIGN KEY (subtask_id) REFERENCES subtasks(id) ON DELETE SET NULL,
  INDEX idx_ws_user_start (user_id, started_at),
  INDEX idx_ws_task (task_id),
  INDEX idx_ws_subtask (subtask_id)
);

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_time_logs'
    AND column_name = 'source'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE task_time_logs
     ADD COLUMN source     ENUM(''manual'',''timer'') NOT NULL DEFAULT ''manual'' AFTER note,
     ADD COLUMN session_id INT NULL AFTER source,
     ADD COLUMN subtask_id INT NULL AFTER session_id,
     ADD UNIQUE KEY uq_ttl_session (session_id),
     ADD INDEX idx_ttl_user_day (user_id, logged_at)',
  'SELECT ''task_time_logs.source already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
