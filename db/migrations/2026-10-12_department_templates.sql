-- Templates that belong to a department.
--
-- A project template already existed, saved from a finished project and
-- shared by everyone. Departments do different work, so "our standard job"
-- means something different in Production than in Design: a template now
-- names the department that made it, and the pickers put yours first.
--
-- Tasks get templates of their own for the same reason. A task template is
-- the form already filled in — title, type and specification, priority,
-- estimate, labels — not a task that exists. It is applied to the New task
-- form, where it can still be changed before anything is created.
--
-- Nothing is hidden by department: a department's templates are its own to
-- make, and everyone else's are still there to borrow.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-12_department_templates.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'project_templates'
    AND column_name = 'department'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE project_templates ADD COLUMN department VARCHAR(100) NULL AFTER description',
  'SELECT ''project_templates.department already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'project_templates'
    AND index_name = 'idx_ptpl_department'
);
SET @sql := IF(@has = 0,
  'CREATE INDEX idx_ptpl_department ON project_templates (department)',
  'SELECT ''idx_ptpl_department already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS task_templates (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(200) NOT NULL,
  department  VARCHAR(100) NULL,
  -- { title, taskType, existingBehavior…, priority, estimatedHours, labelNames }
  data        JSON NOT NULL,
  created_by  INT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ttpl_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ttpl_department (department),
  INDEX idx_ttpl_name (name)
);
