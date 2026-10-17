-- The admin credentials vault: logins for websites the team shares.
--
-- Values are stored encrypted (AES-256-GCM, key in CREDENTIALS_KEY) because
-- a shared login is only useful if it can be read back — unlike a sign-in
-- password, which is checked and never read. Every reveal is recorded, so
-- "who has seen this" is a question with an answer.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-08_credentials.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS credentials (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(200) NOT NULL,            -- "Dealer portal (admin)"
  url              VARCHAR(500) NULL,
  username         VARCHAR(255) NULL,
  password_cipher  TEXT NOT NULL,                    -- v1:iv:tag:ciphertext
  notes_cipher     TEXT NULL,                        -- notes hold secrets too
  project_id       INT NULL,                         -- for grouping only
  created_by       INT NULL,
  updated_by       INT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cred_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  CONSTRAINT fk_cred_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_cred_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_cred_name (name),
  INDEX idx_cred_project (project_id)
);

-- Who read what, and when. Kept even if the credential is deleted.
CREATE TABLE IF NOT EXISTS credential_views (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  credential_id INT NULL,
  credential_name VARCHAR(200) NOT NULL,
  user_id       INT NULL,
  viewed_at     DATETIME NOT NULL,
  CONSTRAINT fk_credview_cred FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE SET NULL,
  CONSTRAINT fk_credview_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_credview_cred (credential_id, viewed_at),
  INDEX idx_credview_user (user_id, viewed_at)
);
