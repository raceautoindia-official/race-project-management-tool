-- A person's designation, mirrored from the Attendance app.
--
-- Same arrangement as department: Attendance owns it, PM reads it and never
-- writes it back, and it is kept in pm_app.users so a PM screen can show who
-- someone is without reaching across to another database on every render.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-13_designation.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users'
    AND column_name = 'designation'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE users ADD COLUMN designation VARCHAR(120) NULL AFTER department',
  'SELECT ''users.designation already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
