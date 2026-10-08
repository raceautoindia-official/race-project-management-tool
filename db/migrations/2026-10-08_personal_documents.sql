-- Personal documents: what someone uploads about themselves.
--
-- ID proof, certificates, a signed contract. Theirs to upload and remove;
-- an admin can see and download them, and that is recorded in the activity
-- log, because reading someone's ID is not the same as reading a task.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-08_personal_documents.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS user_documents (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  category    VARCHAR(60) NOT NULL DEFAULT 'other',
  note        VARCHAR(255) NULL,
  filename    VARCHAR(255) NOT NULL,
  mime_type   VARCHAR(120) NULL,
  size_bytes  INT NOT NULL,
  data        LONGBLOB NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_userdoc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_userdoc_user (user_id, created_at)
);
