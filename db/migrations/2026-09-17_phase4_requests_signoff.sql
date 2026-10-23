-- Phase 4 — project requests, task types + requests, and the sign-off lock.
--
--  * projects: members may REQUEST a project; the nominated lead (owner) or an
--    admin approves/rejects it. Pending/rejected projects are read-only.
--  * tasks: every task is an "existing work correction" or a "new feature" with
--    its own spec fields, and records who requested it, who approved it and who
--    signed it off. A signed-off task is entirely read-only.
--  * task_requests: tasks raised by members, awaiting a lead's approval.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-09-17_phase4_requests_signoff.sql
-- Safe to re-run.

-- ── projects: request / approval ───────────────────────────────────────────
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'projects'
    AND column_name = 'approval_status'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE projects
     ADD COLUMN approval_status ENUM(''pending'',''approved'',''rejected'')
                                NOT NULL DEFAULT ''approved'' AFTER status,
     ADD COLUMN requested_by    INT NULL AFTER owner_id,
     ADD COLUMN requested_at    DATETIME NULL AFTER requested_by,
     ADD COLUMN decided_by      INT NULL AFTER requested_at,
     ADD COLUMN decided_at      DATETIME NULL AFTER decided_by,
     ADD COLUMN decision_note   VARCHAR(1000) NULL AFTER decided_at,
     ADD CONSTRAINT fk_projects_requester FOREIGN KEY (requested_by)
         REFERENCES users(id) ON DELETE SET NULL,
     ADD CONSTRAINT fk_projects_decider FOREIGN KEY (decided_by)
         REFERENCES users(id) ON DELETE SET NULL,
     ADD INDEX idx_projects_approval (approval_status)',
  'SELECT ''projects.approval_status already exists — skipping''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── tasks: type + spec + approval trail + sign-off ─────────────────────────
SET @has := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'tasks'
    AND column_name = 'task_type'
);
SET @sql := IF(@has = 0,
  'ALTER TABLE tasks
     ADD COLUMN task_type ENUM(''general'',''correction'',''feature'')
                          NOT NULL DEFAULT ''general'' AFTER description,
     ADD COLUMN existing_behavior   TEXT NULL AFTER task_type,
     ADD COLUMN expected_behavior   TEXT NULL AFTER existing_behavior,
     ADD COLUMN acceptance_criteria TEXT NULL AFTER expected_behavior,
     ADD COLUMN reason              TEXT NULL AFTER acceptance_criteria,
     ADD COLUMN scope               TEXT NULL AFTER reason,
     ADD COLUMN features            TEXT NULL AFTER scope,
     ADD COLUMN flow                TEXT NULL AFTER features,
     ADD COLUMN rules               TEXT NULL AFTER flow,
     ADD COLUMN request_id          INT NULL,
     ADD COLUMN requested_by        INT NULL,
     ADD COLUMN request_approved_by INT NULL,
     ADD COLUMN request_approved_at DATETIME NULL,
     ADD COLUMN signed_off_by       INT NULL,
     ADD COLUMN signed_off_at       DATETIME NULL,
     ADD COLUMN signoff_note        VARCHAR(1000) NULL,
     ADD CONSTRAINT fk_tasks_requester FOREIGN KEY (requested_by)
         REFERENCES users(id) ON DELETE SET NULL,
     ADD CONSTRAINT fk_tasks_req_approver FOREIGN KEY (request_approved_by)
         REFERENCES users(id) ON DELETE SET NULL,
     ADD CONSTRAINT fk_tasks_signer FOREIGN KEY (signed_off_by)
         REFERENCES users(id) ON DELETE SET NULL,
     ADD INDEX idx_tasks_signed_off (signed_off_at),
     ADD INDEX idx_tasks_request (request_id)',
  'SELECT ''tasks.task_type already exists — skipping''');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Backfill the trail for tasks created before this migration: only admins and
-- leads could create tasks, so the creator (else the project owner) both
-- requested and approved them.
UPDATE tasks t
  LEFT JOIN projects p ON p.id = t.project_id
   SET t.updated_at          = t.updated_at,  -- keep "last updated" as it was
       t.requested_by        = COALESCE(t.created_by, p.owner_id),
       t.request_approved_by = COALESCE(t.request_approved_by, t.created_by, p.owner_id),
       -- created_at is a TIMESTAMP (read in the session time zone); store UTC
       -- like every other *_at DATETIME written with UTC_TIMESTAMP().
       t.request_approved_at = COALESCE(
         t.request_approved_at,
         DATE_SUB(t.created_at, INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND)
       )
 WHERE t.requested_by IS NULL;

-- ── task_requests ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_requests (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  project_id          INT NOT NULL,
  task_type           ENUM('correction','feature') NOT NULL,
  title               VARCHAR(200) NOT NULL,
  existing_behavior   TEXT NULL,
  expected_behavior   TEXT NULL,
  acceptance_criteria TEXT NULL,
  reason              TEXT NULL,
  scope               TEXT NULL,
  features            TEXT NULL,
  flow                TEXT NULL,
  rules               TEXT NULL,
  status              ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  requested_by        INT NULL,
  requested_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- UTC (set explicitly)
  decided_by          INT NULL,
  decided_at          DATETIME NULL,
  decision_note       VARCHAR(1000) NULL,
  task_id             INT NULL,                                     -- the task it became
  CONSTRAINT fk_treq_project   FOREIGN KEY (project_id)   REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_treq_requester FOREIGN KEY (requested_by) REFERENCES users(id)    ON DELETE SET NULL,
  CONSTRAINT fk_treq_decider   FOREIGN KEY (decided_by)   REFERENCES users(id)    ON DELETE SET NULL,
  CONSTRAINT fk_treq_task      FOREIGN KEY (task_id)      REFERENCES tasks(id)    ON DELETE SET NULL,
  INDEX idx_treq_project_status (project_id, status)
);
