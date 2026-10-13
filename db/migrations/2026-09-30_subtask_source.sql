-- Which part of the specification a checklist item came from.
--
-- A task's checklist is seeded from its spec, and the items read as one flat
-- list: you cannot see which are the expected behaviour and which are the
-- acceptance criteria. Recording the field lets the task group them under it.
-- NULL means somebody typed the item on the task itself.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-09-30_subtask_source.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'subtasks'
    AND column_name = 'source'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE subtasks ADD COLUMN source VARCHAR(32) NULL AFTER title',
  'SELECT ''subtasks.source already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
