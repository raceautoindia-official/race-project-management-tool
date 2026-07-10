-- Phase 2 · Wave 2 — Outstanding/approval workflow (#6), meetings & reminders (#5),
-- and due-date alert bookkeeping (#3).
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-02_phase2_wave2.sql

-- ── tasks: approval + outstanding + alert bookkeeping ──────────────────────
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tasks'
    AND column_name = 'outstanding'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE tasks
     ADD COLUMN outstanding      TINYINT(1) NOT NULL DEFAULT 0 AFTER status,
     ADD COLUMN approval_status  ENUM("none","pending","approved","rejected")
                                  NOT NULL DEFAULT "none" AFTER outstanding,
     ADD COLUMN approved_by      INT NULL AFTER approval_status,
     ADD COLUMN approved_at      DATETIME NULL AFTER approved_by,
     ADD COLUMN due_alert_sent   TINYINT(1) NOT NULL DEFAULT 0 AFTER approved_at,
     ADD CONSTRAINT fk_tasks_approver FOREIGN KEY (approved_by)
         REFERENCES users(id) ON DELETE SET NULL,
     ADD INDEX idx_tasks_outstanding (outstanding),
     ADD INDEX idx_tasks_approval (approval_status)',
  'SELECT "tasks approval columns already exist — skipping"');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── meetings ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  title            VARCHAR(200) NOT NULL,
  description      TEXT,
  project_id       INT NULL,
  location         VARCHAR(255) NULL,            -- room or video link
  start_time       DATETIME NOT NULL,
  reminder_minutes INT NULL,                     -- remind this many min before start
  reminder_sent    TINYINT(1) NOT NULL DEFAULT 0,
  created_by       INT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_meetings_project FOREIGN KEY (project_id)
    REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_meetings_creator FOREIGN KEY (created_by)
    REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_meetings_start (start_time),
  INDEX idx_meetings_reminder (reminder_sent, start_time)
);

CREATE TABLE IF NOT EXISTS meeting_attendees (
  meeting_id INT NOT NULL,
  user_id    INT NOT NULL,
  PRIMARY KEY (meeting_id, user_id),
  CONSTRAINT fk_ma_meeting FOREIGN KEY (meeting_id)
    REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_ma_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
);
