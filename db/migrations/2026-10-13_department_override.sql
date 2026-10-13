-- Who decides a person's department, and where their job title lives.
--
-- Attendance is still the source for departments, but its data has gaps and
-- mistakes, so an admin can set one here and have it stick. This column says
-- which of the two is in charge for each person: 'attendance' (the default)
-- means the mirror keeps overwriting it as it always has; 'pm' means someone
-- here set it on purpose and the mirror leaves it alone. Clearing it in the
-- app puts the person back to following Attendance.
--
-- Job titles have no column in attendance_db.employees at all — the table
-- records a department and a role, and nothing else about what someone does.
-- So users.designation, added earlier the same day, is PM's own: nothing
-- mirrors it, and an admin fills it in.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-13_department_override.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users'
    AND column_name = 'department_source'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE users ADD COLUMN department_source ENUM(''attendance'',''pm'')
     NOT NULL DEFAULT ''attendance'' AFTER department',
  'SELECT ''users.department_source already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
