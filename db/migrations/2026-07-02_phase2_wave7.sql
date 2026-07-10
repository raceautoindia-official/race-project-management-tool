-- Phase 2 · Wave 7 — task time logs (auditable hours) + review-gate helpers.
-- Each row is one logged time entry (who, how many minutes, note, when).
-- tasks.spent_hours becomes the cached SUM(minutes)/60 of these entries.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-02_phase2_wave7.sql

CREATE TABLE IF NOT EXISTS task_time_logs (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  task_id    INT NOT NULL,
  user_id    INT NULL,
  minutes    INT NOT NULL,
  note       VARCHAR(255) NULL,
  logged_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ttl_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_ttl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ttl_task (task_id)
);

-- Backfill: turn any existing single spent_hours value into one seed log entry
-- so history isn't lost (only for tasks that have spent hours but no logs yet).
INSERT INTO task_time_logs (task_id, user_id, minutes, note)
SELECT t.id, t.assignee_id, ROUND(t.spent_hours * 60), 'migrated from spent_hours'
  FROM tasks t
 WHERE t.spent_hours > 0
   AND NOT EXISTS (SELECT 1 FROM task_time_logs l WHERE l.task_id = t.id);
