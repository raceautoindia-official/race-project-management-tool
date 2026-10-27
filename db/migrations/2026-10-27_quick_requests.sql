-- Quick requests: a member can ask for a plain task — a title, a few steps and
-- a line of description — not only a correction or a new feature with its
-- full specification. The steps become the task's subtasks when it is
-- approved, the same way a specification's points do.
--
-- * task_requests.task_type gains 'general' (the plain task type tasks
--   already have).
-- * task_requests.description and task_requests.steps hold what a quick
--   request says. Both are new, nullable columns: every existing request
--   keeps exactly what it had.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-27_quick_requests.sql
-- Safe to re-run.

SET @type := (
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_requests'
    AND column_name = 'task_type'
);
SET @sql := IF(@type NOT LIKE '%general%',
  'ALTER TABLE task_requests
     MODIFY COLUMN task_type ENUM(''correction'',''feature'',''general'') NOT NULL',
  'SELECT ''task_requests.task_type already allows general'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_requests'
    AND column_name = 'steps'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE task_requests
     ADD COLUMN description TEXT NULL AFTER title,
     ADD COLUMN steps       TEXT NULL AFTER rules',
  'SELECT ''task_requests.description/steps already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
