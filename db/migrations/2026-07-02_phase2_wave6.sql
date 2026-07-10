-- Phase 2 · Wave 6 — task dependencies (blocked-by).
-- A task can depend on one or more other tasks in the same project that must be
-- completed first. Used to warn before starting a blocked task.
--
-- Apply:  mysql -u <user> -p pm_app < db/migrations/2026-07-02_phase2_wave6.sql

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id            INT NOT NULL,   -- the dependent (blocked) task
  depends_on_task_id INT NOT NULL,   -- must be done first
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, depends_on_task_id),
  CONSTRAINT fk_dep_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_dep_on   FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_dep_on (depends_on_task_id)
);
