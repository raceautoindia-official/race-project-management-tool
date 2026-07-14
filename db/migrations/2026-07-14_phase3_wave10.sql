-- Phase 3 · Wave 10 — task start dates (for the timeline/Gantt) + milestones.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-14_phase3_wave10.sql

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tasks'
    AND column_name = 'start_date'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE tasks ADD COLUMN start_date DATE NULL AFTER due_date',
  'SELECT "tasks.start_date already exists — skipping"');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS milestones (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  project_id   INT NOT NULL,
  name         VARCHAR(200) NOT NULL,
  due_date     DATE NULL,
  is_done      TINYINT(1) NOT NULL DEFAULT 0,
  completed_at DATETIME NULL,
  created_by   INT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ms_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_ms_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_milestones_project (project_id)
);
