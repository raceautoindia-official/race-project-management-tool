-- People who left: retired, not deleted.
--
-- Attendance owns who works here. PM used to learn that someone had gone only
-- when they next signed in — which people who have left never do — so they
-- stayed on every list. A sweep now checks everyone against Attendance and
-- retires whoever was removed or deactivated there; their tasks, comments and
-- history stay, and they show on Team › Retired instead of with current staff.
--
-- * users.retired_at: when PM noticed they had gone (NULL while they work here).
-- * users.retired_reason: 'removed' (no longer in Attendance at all) or
--   'deactivated' (still there, switched off).
-- * Anyone already inactive is counted as retired from their last change.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-31_retired_staff.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users'
    AND column_name = 'retired_at'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE users
     ADD COLUMN retired_at     DATETIME NULL AFTER is_active,
     ADD COLUMN retired_reason ENUM(''removed'',''deactivated'') NULL AFTER retired_at',
  'SELECT ''users.retired_at already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE users SET retired_at = updated_at
 WHERE is_active = 0 AND retired_at IS NULL;
