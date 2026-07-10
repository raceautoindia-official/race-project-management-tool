-- Phase 2 · Wave 5 — user presence (online status) for the enhanced activity panel.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-02_phase2_wave5.sql

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'users'
    AND column_name = 'last_seen_at'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE users
     ADD COLUMN last_seen_at DATETIME NULL,
     ADD INDEX idx_users_last_seen (last_seen_at)',
  'SELECT "users.last_seen_at already exists — skipping"');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
