-- Whether a meeting's invitation actually went out by email.
--
-- The calendar feed used to leave meetings out whenever mail was *configured*,
-- on the assumption the invitation would land. A configured mailer that cannot
-- actually send (an unverified sender, a rejected credential) then put the
-- meeting in nobody's calendar at all. Recording the send makes the feed carry
-- exactly the meetings no invitation reached.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-09-26_meeting_invite_delivery.sql
-- Safe to re-run.

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'meetings'
    AND column_name = 'invite_sent_at'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE meetings ADD COLUMN invite_sent_at DATETIME NULL AFTER reminder_sent',
  'SELECT ''meetings.invite_sent_at already present'''
);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
