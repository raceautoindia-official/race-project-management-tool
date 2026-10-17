-- Departments: whose work this is.
--
-- The department itself belongs to the Attendance app
-- (attendance.employees.department), which PM reads and never writes. This
-- mirrors it into pm_app.users the same way role and is_active are already
-- mirrored, so filtering by department is one join away and an Attendance
-- outage does not empty every list in the product.
--
-- A project names the department that owns it; its tasks count to that
-- department, so there is nothing to keep in step per task.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-12_departments.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users'
    AND column_name = 'department'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE users ADD COLUMN department VARCHAR(100) NULL AFTER email',
  'SELECT ''users.department already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'users'
    AND index_name = 'idx_users_department'
);
SET @sql := IF(@has = 0,
  'CREATE INDEX idx_users_department ON users (department)',
  'SELECT ''idx_users_department already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'projects'
    AND column_name = 'department'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE projects ADD COLUMN department VARCHAR(100) NULL AFTER description',
  'SELECT ''projects.department already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'projects'
    AND index_name = 'idx_projects_department'
);
SET @sql := IF(@has = 0,
  'CREATE INDEX idx_projects_department ON projects (department)',
  'SELECT ''idx_projects_department already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
