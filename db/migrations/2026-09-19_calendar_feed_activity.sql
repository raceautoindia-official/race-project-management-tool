-- Record when a calendar app last fetched someone's feed.
--
-- Subscriptions are invisible from this side: the subscription lives in the
-- person's Google/Outlook/Apple account and those services never tell us it
-- exists. The one thing we can observe is the fetch itself, which is enough
-- to say "yes, a calendar app is reading this" instead of showing the same
-- "Add to…" button forever.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-09-19_calendar_feed_activity.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users'
    AND column_name = 'calendar_feed_fetched_at'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE users
     ADD COLUMN calendar_feed_fetched_at DATETIME NULL AFTER calendar_token',
  'SELECT ''users.calendar_feed_fetched_at already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
