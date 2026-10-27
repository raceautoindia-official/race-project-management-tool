-- Files on a task request: a member asking for work can attach what explains
-- it (a drawing, a photo of the fault). They stay with the request while it
-- waits; approving it moves them onto the task it becomes, rejecting it
-- leaves them with the request, and withdrawing it deletes them with it.
--
-- A table of its own rather than a nullable column on task_attachments, so
-- nothing that lists a task's or a project's files has to learn to skip
-- requests.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-28_request_attachments.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS task_request_attachments (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  request_id  INT NOT NULL,
  uploaded_by INT NULL,
  filename    VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(120) NULL,
  size_bytes  INT NOT NULL,
  data        LONGBLOB NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ratt_request FOREIGN KEY (request_id) REFERENCES task_requests(id) ON DELETE CASCADE,
  CONSTRAINT fk_ratt_user    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ratt_request (request_id)
);
