-- Who can see a stored login.
--
-- The vault started admin-only. A shared login is no use locked away from the
-- people who need it, so each one now says who it is for: admins only (how
-- everything already saved stays), everyone on its project, or named people.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-08_credential_sharing.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'credentials'
    AND column_name = 'visibility'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE credentials
     ADD COLUMN visibility ENUM(''admins'',''project'',''people'')
       NOT NULL DEFAULT ''admins'' AFTER notes_cipher,
     ADD INDEX idx_cred_visibility (visibility)',
  'SELECT ''credentials.visibility already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS credential_access (
  credential_id INT NOT NULL,
  user_id       INT NOT NULL,
  PRIMARY KEY (credential_id, user_id),
  CONSTRAINT fk_credaccess_cred FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE CASCADE,
  CONSTRAINT fk_credaccess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_credaccess_user (user_id)
);
