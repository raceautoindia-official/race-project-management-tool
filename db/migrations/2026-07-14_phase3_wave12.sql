-- Phase 3 · Wave 12 — recurring tasks & meetings + project templates.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-14_phase3_wave12.sql

-- Recurring task definitions: a cron materializes a real task each period.
CREATE TABLE IF NOT EXISTS recurring_tasks (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  project_id      INT NOT NULL,
  title           VARCHAR(200) NOT NULL,
  description     TEXT NULL,
  priority        ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  assignee_id     INT NULL,
  estimated_hours DECIMAL(6,2) NULL,
  recurrence      ENUM('daily','weekly','monthly') NOT NULL DEFAULT 'weekly',
  next_run        DATE NOT NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_by      INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rt_project  FOREIGN KEY (project_id)  REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_rt_assignee FOREIGN KEY (assignee_id) REFERENCES users(id)    ON DELETE SET NULL,
  CONSTRAINT fk_rt_creator  FOREIGN KEY (created_by)  REFERENCES users(id)    ON DELETE SET NULL,
  INDEX idx_rt_next (is_active, next_run)
);

-- Meetings: recurrence + the series id (the first meeting's id) for materializing.
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'meetings'
    AND column_name = 'recurrence'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE meetings
     ADD COLUMN recurrence ENUM("none","daily","weekly","monthly") NOT NULL DEFAULT "none",
     ADD COLUMN series_id INT NULL,
     ADD INDEX idx_meetings_series (series_id)',
  'SELECT "meetings.recurrence already exists — skipping"');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Project templates: a saved structure (labels, tasks, milestones) as JSON.
CREATE TABLE IF NOT EXISTS project_templates (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  description TEXT NULL,
  data        JSON NOT NULL,
  created_by  INT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tpl_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
