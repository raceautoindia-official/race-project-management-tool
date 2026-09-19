-- Corrects completion times written by the 2026-07-14 wave 8 backfill.
--
-- That migration ran:
--     SET completed_at = COALESCE(approved_at, updated_at)
-- `approved_at` is a DATETIME already stored in UTC, but `updated_at` is a
-- TIMESTAMP, which MySQL returns in the session's time zone. On a server set to
-- IST that put a local wall-clock time into a column the app reads as UTC, so
-- those tasks show as completed 5h30m later than they were.
--
-- Affected rows are exactly the ones that fell back to `updated_at`: a
-- completion time with no approval time. Everything since is written with
-- UTC_TIMESTAMP() and is already correct.
--
-- Shifting times twice would be worse than not shifting them at all, so this
-- records that it ran and does nothing on a second run.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-09-18_fix_legacy_completed_at.sql
-- Safe to re-run.

-- Explicit charset/collation: comparing this column with a literal must not
-- depend on the server's default (an "illegal mix of collations" otherwise).
CREATE TABLE IF NOT EXISTS applied_data_fixes (
  name       VARCHAR(190) PRIMARY KEY,
  applied_at DATETIME NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- A literal, not a user variable: variables carry the connection's collation
-- and compare at the same strength as the column, which MySQL rejects.
SET @already := (
  SELECT COUNT(*) FROM applied_data_fixes WHERE name = '2026-09-18_legacy_completed_at_utc'
);
-- How far the session's clock is ahead of UTC (19800 seconds for IST).
SET @offset := TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW());

SET @sql := IF(@already = 0 AND @offset <> 0,
  'UPDATE tasks
      SET updated_at   = updated_at,   -- keep "last updated" as it was
          completed_at = DATE_SUB(completed_at, INTERVAL @offset SECOND)
    WHERE completed_at IS NOT NULL
      AND approved_at IS NULL',
  'SELECT ''legacy completed_at already corrected (or server runs on UTC) — skipping''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

INSERT IGNORE INTO applied_data_fixes (name, applied_at)
VALUES ('2026-09-18_legacy_completed_at_utc', UTC_TIMESTAMP());
