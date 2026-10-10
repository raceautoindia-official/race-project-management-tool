-- The daily / weekly planner: what someone means to do, and how it went.
--
-- Written by the person, not worked out by the app. One row per person per
-- day, and one per person per week (dated to that week's Monday), so both
-- live in the same table and neither can be entered twice.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-08_planner.sql
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS planner_entries (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  period     ENUM('day','week') NOT NULL,
  entry_date DATE NOT NULL,              -- the day, or that week's Monday
  plan       TEXT NULL,                  -- what they mean to do
  progress   TEXT NULL,                  -- how it went
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_planner_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_planner_entry (user_id, period, entry_date),
  INDEX idx_planner_date (entry_date, period)
);
