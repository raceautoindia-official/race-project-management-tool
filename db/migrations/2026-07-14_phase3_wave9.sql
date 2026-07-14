-- Phase 3 · Wave 9 — task file attachments + comment editing.
--
-- Attachments are stored in the DB (LONGBLOB) to avoid filesystem/serving
-- complexity and to survive across the pm2 cluster; uploads are capped at 10MB
-- in the API. Adds task_comments.edited_at for the "(edited)" indicator.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-14_phase3_wave9.sql

CREATE TABLE IF NOT EXISTS task_attachments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  task_id     INT NOT NULL,
  uploaded_by INT NULL,
  filename    VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(120) NULL,
  size_bytes  INT NOT NULL,
  data        LONGBLOB NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_att_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_att_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_att_task (task_id)
);

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_comments'
    AND column_name = 'edited_at'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE task_comments ADD COLUMN edited_at DATETIME NULL',
  'SELECT "task_comments.edited_at already exists — skipping"');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
