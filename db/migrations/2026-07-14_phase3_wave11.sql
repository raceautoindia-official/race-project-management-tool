-- Phase 3 · Wave 11 — personal reminders / scheduled activities + web push.
--
-- reminders: general schedulable items (payment reminders, renewals, follow-ups,
-- custom) that fire an in-app + email (+ web push) reminder N minutes before
-- their scheduled time, with optional recurrence. They also appear on the
-- calendar. push_subscriptions stores browser Web Push endpoints per user.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-14_phase3_wave11.sql

CREATE TABLE IF NOT EXISTS reminders (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NOT NULL,
  title            VARCHAR(200) NOT NULL,
  category         VARCHAR(40) NOT NULL DEFAULT 'general',
  notes            TEXT NULL,
  scheduled_at     DATETIME NOT NULL,                    -- target time (UTC)
  reminder_minutes INT NOT NULL DEFAULT 0,               -- fire this many min before
  recurrence       ENUM('none','daily','weekly','monthly') NOT NULL DEFAULT 'none',
  notify_email     TINYINT(1) NOT NULL DEFAULT 1,
  notify_push      TINYINT(1) NOT NULL DEFAULT 1,
  is_done          TINYINT(1) NOT NULL DEFAULT 0,
  reminder_sent    TINYINT(1) NOT NULL DEFAULT 0,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reminders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_reminders_user (user_id),
  INDEX idx_reminders_fire (reminder_sent, is_done, scheduled_at)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  endpoint   VARCHAR(500) NOT NULL,
  p256dh     VARCHAR(255) NOT NULL,
  auth       VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_endpoint (endpoint),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_push_user (user_id)
);
