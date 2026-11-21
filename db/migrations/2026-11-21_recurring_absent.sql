-- Recurring copies wait for their owner to be at work (clocked in on
-- WorkLens). A date the owner never clocked in is recorded as skipped with
-- the reason 'absent'.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-11-21_recurring_absent.sql
-- Safe to re-run.

ALTER TABLE recurring_skips
  MODIFY COLUMN reason ENUM('holiday','day_off','absent','still_open','missed','skipped') NOT NULL;
