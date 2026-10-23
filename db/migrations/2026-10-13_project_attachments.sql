-- Files that belong to a project rather than to one of its tasks.
--
-- A project usually starts from something: a brief, a drawing, a quotation,
-- an email from the customer. Until now the only place to put that was on a
-- task, which meant inventing a task to hold it.
--
-- Stored exactly as task attachments are — the bytes in the row, capped at
-- 10 MB — so there is one way files work in this product and one thing to
-- back up.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-13_project_attachments.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS project_attachments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  project_id  INT NOT NULL,
  uploaded_by INT NULL,
  filename    VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(120) NULL,
  size_bytes  INT NOT NULL,
  data        LONGBLOB NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_patt_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_patt_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_patt_project (project_id)
);
