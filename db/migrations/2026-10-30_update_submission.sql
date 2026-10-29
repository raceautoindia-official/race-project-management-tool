-- Work updates are submitted, not just saved.
--
-- * planner_entries.submitted_at / submission: when an entry was handed in,
--   and whether the person did it ('manual') or the app did at the end of
--   the day ('auto'). Entries saved before this keep NULL — a draft.
-- * app_settings: small admin-set values, starting with when the update
--   reminders go out.
-- * update_reminders: every reminder sent, automatic or by an admin, so the
--   updates grid can say who was reminded and when.
-- * job_runs: which scheduled jobs already ran for which day, so a cron that
--   fires every 15 minutes does each job once.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-30_update_submission.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'planner_entries'
    AND column_name = 'submitted_at'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE planner_entries
     ADD COLUMN submitted_at DATETIME NULL AFTER progress,
     ADD COLUMN submission   ENUM(''manual'',''auto'') NULL AFTER submitted_at',
  'SELECT ''planner_entries.submitted_at already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  INT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Submitting starts today: days before it were never asked for, so they are
-- not counted as missing.
INSERT IGNORE INTO app_settings (setting_key, value)
VALUES ('work_updates_since', DATE_FORMAT(CURRENT_DATE(), '%Y-%m-%d'));

CREATE TABLE IF NOT EXISTS update_reminders (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  user_id   INT NOT NULL,
  kind      ENUM('day','week_plan','week_summary') NOT NULL,
  ref_date  DATE NOT NULL,                 -- the day, or that week's Monday
  sent_by   INT NULL,                      -- NULL: sent automatically
  sent_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ureminder_user   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ureminder_sender FOREIGN KEY (sent_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ureminder_ref (kind, ref_date, user_id)
);

CREATE TABLE IF NOT EXISTS job_runs (
  job     VARCHAR(40) NOT NULL,
  run_for VARCHAR(20) NOT NULL,            -- usually the day it ran for
  ran_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job, run_for)
);
