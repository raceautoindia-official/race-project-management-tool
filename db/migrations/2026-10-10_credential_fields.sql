-- Whatever else a login needs: an account ID, the email it is registered to,
-- a customer number. Kept as named fields rather than more columns, because
-- every site asks for something different.
--
-- Encrypted like the password: an account number is not a secret on its own,
-- but next to the password it is half of one.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-10_credential_fields.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'credentials'
    AND column_name = 'fields_cipher'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE credentials ADD COLUMN fields_cipher TEXT NULL AFTER notes_cipher',
  'SELECT ''credentials.fields_cipher already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
