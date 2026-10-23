-- Redesign fundamentals: Project › Task › Subtask with owners, review, weights
-- and dates (docs/REDESIGN_PLAN.md, docs/IMPLEMENTATION_MAPPING.md).
--
-- * A subtask stops being a bare checklist line and becomes a piece of work:
--   it has an assignee, dates, a status that goes through the task owner's
--   review, and a weight (its share of the task's progress). The table is
--   extended rather than replaced, so every existing checklist row survives
--   and `is_done` keeps meaning what it meant (it stays in step with
--   status = 'done').
-- * Tasks get a weight (their share of the project) and a position in the
--   project's task list. The status ENUM is deliberately unchanged.
-- * Projects get start and due dates.
-- * Comments and files can belong to a subtask (still filed under its task,
--   so everything that lists a task's comments or files keeps working).
-- * designation_levels gives each job title a level so seniority can be
--   compared across differently named titles. users.designation stays the
--   free-text title it is today; the level is looked up by that title.
--
-- Department storage and the Attendance sync are not touched.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-10-17_redesign_fundamentals.sql
-- Safe to re-run: every change checks first, and the one-off data backfill
-- records itself in applied_data_fixes.

-- ── subtasks ──────────────────────────────────────────────────────────────
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'subtasks'
    AND column_name = 'assignee_id'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE subtasks
     ADD COLUMN description       TEXT NULL AFTER title,
     ADD COLUMN assignee_id       INT NULL AFTER source,
     ADD COLUMN status            ENUM(''todo'',''in_progress'',''review'',''done'',''cancelled'')
                                  NOT NULL DEFAULT ''todo'' AFTER assignee_id,
     ADD COLUMN start_date        DATE NULL AFTER position,
     ADD COLUMN due_date          DATE NULL AFTER start_date,
     ADD COLUMN weight            DECIMAL(6,3) NOT NULL DEFAULT 0 AFTER due_date,
     ADD COLUMN weight_mode       ENUM(''auto'',''manual'') NOT NULL DEFAULT ''auto'' AFTER weight,
     ADD COLUMN submitted_at      DATETIME NULL AFTER weight_mode,
     ADD COLUMN approved_by       INT NULL AFTER submitted_at,
     ADD COLUMN approved_at       DATETIME NULL AFTER approved_by,
     ADD COLUMN changes_requested VARCHAR(1000) NULL AFTER approved_at,
     ADD COLUMN created_by        INT NULL AFTER changes_requested,
     ADD COLUMN updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
     ADD CONSTRAINT fk_subtasks_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
     ADD CONSTRAINT fk_subtasks_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
     ADD CONSTRAINT fk_subtasks_creator  FOREIGN KEY (created_by)  REFERENCES users(id) ON DELETE SET NULL,
     ADD INDEX idx_subtasks_assignee (assignee_id, status),
     ADD INDEX idx_subtasks_due (due_date)',
  'SELECT ''subtasks redesign columns already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Due-date reminders for subtasks: 0 none sent, 1 "due soon" sent, 2 "overdue"
-- sent. Reset to 0 when the due date changes. (Separate check so databases
-- that ran an earlier draft of this migration still get it.)
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'subtasks'
    AND column_name = 'due_alert_sent'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE subtasks ADD COLUMN due_alert_sent TINYINT NOT NULL DEFAULT 0 AFTER due_date',
  'SELECT ''subtasks.due_alert_sent already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── tasks ─────────────────────────────────────────────────────────────────
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tasks'
    AND column_name = 'weight'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE tasks
     ADD COLUMN weight      DECIMAL(6,3) NOT NULL DEFAULT 0 AFTER priority,
     ADD COLUMN weight_mode ENUM(''auto'',''manual'') NOT NULL DEFAULT ''auto'' AFTER weight,
     ADD COLUMN position    INT NOT NULL DEFAULT 0 AFTER weight_mode',
  'SELECT ''tasks.weight already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── projects ──────────────────────────────────────────────────────────────
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'projects'
    AND column_name = 'start_date'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE projects
     ADD COLUMN start_date DATE NULL AFTER status,
     ADD COLUMN due_date   DATE NULL AFTER start_date',
  'SELECT ''projects.start_date already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── comments & files on a subtask ─────────────────────────────────────────
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_comments'
    AND column_name = 'subtask_id'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE task_comments
     ADD COLUMN subtask_id INT NULL AFTER task_id,
     ADD CONSTRAINT fk_comments_subtask FOREIGN KEY (subtask_id) REFERENCES subtasks(id) ON DELETE CASCADE,
     ADD INDEX idx_comments_subtask (subtask_id)',
  'SELECT ''task_comments.subtask_id already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'task_attachments'
    AND column_name = 'subtask_id'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE task_attachments
     ADD COLUMN subtask_id INT NULL AFTER task_id,
     ADD CONSTRAINT fk_att_subtask FOREIGN KEY (subtask_id) REFERENCES subtasks(id) ON DELETE CASCADE,
     ADD INDEX idx_att_subtask (subtask_id)',
  'SELECT ''task_attachments.subtask_id already present''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── designation levels ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS designation_levels (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(120) NOT NULL,           -- matches users.designation
  level      TINYINT UNSIGNED NULL,           -- 1 = most junior; NULL = not set yet
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_designation_title (title)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Every job title already in use appears in Admin, waiting for a level.
INSERT IGNORE INTO designation_levels (title)
SELECT DISTINCT TRIM(designation) FROM users
 WHERE designation IS NOT NULL AND TRIM(designation) <> '';

-- ── one-off data backfill ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applied_data_fixes (
  name       VARCHAR(190) PRIMARY KEY,
  applied_at DATETIME NOT NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

SET @already := (
  SELECT COUNT(*) FROM applied_data_fixes WHERE name = '2026-10-17_redesign_fundamentals'
);

-- Existing checklist items belong to the person who owns the task.
SET @sql := IF(@already = 0,
  'UPDATE subtasks s JOIN tasks t ON t.id = s.task_id
      SET s.assignee_id = t.assignee_id
    WHERE s.assignee_id IS NULL',
  'SELECT ''redesign backfill already applied — skipping''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Ticked items were ticked by (or for) the task owner, who is also the
-- reviewer of their own subtask, so they count as approved.
SET @sql := IF(@already = 0,
  'UPDATE subtasks s JOIN tasks t ON t.id = s.task_id
      SET s.status = ''done'',
          s.submitted_at = UTC_TIMESTAMP(),
          s.approved_at  = UTC_TIMESTAMP(),
          s.approved_by  = t.assignee_id
    WHERE s.is_done = 1 AND s.status = ''todo''',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- A project starts when it was created (or its earliest task, if earlier)
-- and is due when its last task is due. Projects with no dated tasks keep
-- an open due date for the owner to set.
SET @sql := IF(@already = 0,
  'UPDATE projects p
      LEFT JOIN (SELECT project_id,
                        MIN(COALESCE(start_date, due_date)) AS first_day,
                        MAX(due_date) AS last_day
                   FROM tasks GROUP BY project_id) d ON d.project_id = p.id
      SET p.updated_at = p.updated_at,
          p.start_date = LEAST(DATE(p.created_at), COALESCE(d.first_day, DATE(p.created_at))),
          p.due_date   = d.last_day
    WHERE p.start_date IS NULL',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Keep today's on-screen order (oldest first) as the tasks' position.
SET @sql := IF(@already = 0,
  'UPDATE tasks t
      JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) - 1 AS pos
              FROM tasks) r ON r.id = t.id
      SET t.updated_at = t.updated_at, t.position = r.pos',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

INSERT IGNORE INTO applied_data_fixes (name, applied_at)
VALUES ('2026-10-17_redesign_fundamentals', UTC_TIMESTAMP());
