-- Phase 5 — calendar subscriptions, video meetings and WhatsApp alerts.
--
--  * users: a private calendar-feed token, a phone number and a WhatsApp opt-in.
--  * meetings: how long they run, and the video call they belong to.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-09-18_phase5_calendar_video_whatsapp.sql
-- Safe to re-run.

-- ── users: calendar feed + WhatsApp ────────────────────────────────────────
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users'
    AND column_name = 'calendar_token'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE users
     ADD COLUMN calendar_token   CHAR(32) NULL AFTER last_seen_at,
     ADD COLUMN phone            VARCHAR(20) NULL AFTER email,
     ADD COLUMN whatsapp_opt_in  TINYINT(1) NOT NULL DEFAULT 0 AFTER phone,
     ADD UNIQUE KEY uniq_users_calendar_token (calendar_token)',
  'SELECT ''users.calendar_token already exists — skipping''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── meetings: duration + video call ────────────────────────────────────────
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'meetings'
    AND column_name = 'video_url'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE meetings
     ADD COLUMN duration_minutes INT NOT NULL DEFAULT 30 AFTER start_time,
     ADD COLUMN video_url        VARCHAR(500) NULL AFTER location,
     ADD COLUMN video_room_id    VARCHAR(120) NULL AFTER video_url',
  'SELECT ''meetings.video_url already exists — skipping''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
