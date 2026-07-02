-- Project Management App — schema
-- Apply with:  mysql -u root -p < db/schema.sql

CREATE DATABASE IF NOT EXISTS pm_app
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE pm_app;

-- Users — mirror of the parent Attendance app's `employees` table.
--
-- Identity + credentials live ONLY in the attendance DB. This table is a
-- local projection so PM's foreign keys (projects, tasks, comments, …) keep
-- working. Rows are provisioned/refreshed automatically on login and by the
-- sync script (`npm run seed`). `employee_id` links back to
-- attendance.employees.id.
--
-- `password_hash` and `must_change_password` are retained (nullable / unused)
-- for backwards-compatibility with older code paths; PM never authenticates
-- against them — the PIN is verified against the attendance DB.
CREATE TABLE IF NOT EXISTS users (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  employee_id          INT NOT NULL UNIQUE,          -- attendance.employees.id
  emp_id               VARCHAR(20) NOT NULL UNIQUE,   -- attendance.employees.emp_id
  name                 VARCHAR(120) NOT NULL,
  email                VARCHAR(190) NULL,
  password_hash        VARCHAR(255) NULL,             -- unused (federated auth)
  role                 ENUM('admin','member') NOT NULL DEFAULT 'member',
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE, -- unused (federated auth)
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  description TEXT,
  status      ENUM('active','completed','archived') NOT NULL DEFAULT 'active',
  owner_id    INT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_projects_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Which users belong to which project
CREATE TABLE IF NOT EXISTS project_members (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  project_id      INT NOT NULL,
  user_id         INT NOT NULL,
  role_in_project ENUM('lead','member') NOT NULL DEFAULT 'member',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_project_user (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  project_id  INT NOT NULL,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  status      ENUM('todo','in_progress','review','done') NOT NULL DEFAULT 'todo',
  priority    ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  assignee_id INT,
  created_by  INT,
  due_date    DATE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tasks_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_tasks_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_tasks_project (project_id),
  INDEX idx_tasks_assignee (assignee_id),
  INDEX idx_tasks_status (status)
);

CREATE TABLE IF NOT EXISTS task_comments (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  task_id    INT NOT NULL,
  user_id    INT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_comments_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_comments_task (task_id)
);

-- Audit / activity trail
CREATE TABLE IF NOT EXISTS activity_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT,
  action      VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id   INT,
  metadata    JSON,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_activity_created (created_at)
);

-- In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  type       VARCHAR(40) NOT NULL,
  message    VARCHAR(255) NOT NULL,
  link       VARCHAR(255),
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notif_user (user_id, is_read)
);

-- Per-project task labels / tags
CREATE TABLE IF NOT EXISTS labels (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  name       VARCHAR(50) NOT NULL,
  color      VARCHAR(20) NOT NULL DEFAULT 'slate',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_labels_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_project_label (project_id, name)
);

-- Many-to-many: which labels are on which task
CREATE TABLE IF NOT EXISTS task_labels (
  task_id  INT NOT NULL,
  label_id INT NOT NULL,
  PRIMARY KEY (task_id, label_id),
  CONSTRAINT fk_tl_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tl_label FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);

-- Task checklists / subtasks
CREATE TABLE IF NOT EXISTS subtasks (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  task_id    INT NOT NULL,
  title      VARCHAR(255) NOT NULL,
  is_done    BOOLEAN NOT NULL DEFAULT FALSE,
  position   INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_subtasks_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_subtasks_task (task_id)
);
