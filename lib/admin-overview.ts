import "server-only";
import { query, DbRow } from "./db";
import { getProjectProgressRows, type ProjectProgressRow } from "./work-views";
import { forecast, scheduleHealth, type Health } from "./work-engine";
import type { User } from "./types";

/**
 * lib/admin-overview.ts — the Control centre's figures: how the
 * organisation's work is going, what is waiting on a decision, where reviews
 * pile up, who is overloaded or idle, and which records need fixing. Read
 * only; every action stays where it already lives (project pages, Approvals,
 * People & levels).
 */

const OPEN_PROJECT = `p.approval_status = 'approved' AND p.status = 'active'`;
const HAS_SUBTASKS = `EXISTS (SELECT 1 FROM subtasks x WHERE x.task_id = t.id AND x.status <> 'cancelled')`;

export interface PortfolioRow extends ProjectProgressRow {
  health: Health;
  /** Where approved progress should be by today, 0–100 (null without dates). */
  expected: number | null;
  /** Projected finish at the current pace (null when there is no pace yet). */
  eta: string | null;
  daysLate: number | null;
}

export interface Decisions {
  projectRequests: number;
  taskRequests: number;
  finishedTasks: number;
  finishedSubtasks: number;
  blockers: number;
  signOffs: number;
  readyToClose: number;
}

export interface ReviewerLoad {
  reviewer_id: number | null;
  name: string | null;
  waiting: number;
  oldest: string | null;
}

export interface PersonLoad {
  id: number;
  name: string;
  department: string | null;
  designation: string | null;
  open_items: number;
  overdue: number;
}

export interface DataIssue {
  key: string;
  label: string;
  count: number;
  href: string;
  /** A few examples, so the admin knows what to look for. */
  examples: string[];
}

export interface AdminOverview {
  portfolio: PortfolioRow[];
  decisions: Decisions;
  reviewers: ReviewerLoad[];
  people: PersonLoad[];
  idle: PersonLoad[];
  dataIssues: DataIssue[];
}

/** Worst first: the projects that need an admin's eye lead the list. */
const HEALTH_ORDER: Record<Health, number> = {
  off_track: 0,
  at_risk: 1,
  no_dates: 2,
  on_track: 3,
  not_started: 4,
  done: 5,
};

/**
 * A department name that looks like an ID or a phone number rather than a
 * department ("ADMIN001", "7305408577") — usually a column mixed up in the
 * Attendance data.
 */
export function looksLikeCode(name: string): boolean {
  const n = name.trim();
  return /^\+?\d[\d\s-]{3,}$/.test(n) || /^[A-Za-z]{2,}\d{2,}$/.test(n);
}

const count = async (sql: string, params: unknown[] = []) =>
  Number((await query<DbRow[]>(sql, params))[0]?.c ?? 0);

export async function getAdminOverview(user: User, today: string): Promise<AdminOverview> {
  const portfolio: PortfolioRow[] = (await getProjectProgressRows(user))
    .map((r) => {
      const start = r.start_date ? String(r.start_date).slice(0, 10) : null;
      const due = r.due_date ? String(r.due_date).slice(0, 10) : null;
      const { health, expected } = scheduleHealth(r.percent, start, due, today);
      const f = forecast(r.percent, start, due, today);
      return { ...r, health, expected, eta: f.eta, daysLate: f.daysLate };
    })
    .sort((a, b) => HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health] || b.overdue_count - a.overdue_count || a.percent - b.percent);

  const decisions: Decisions = {
    projectRequests: await count(`SELECT COUNT(*) c FROM projects WHERE approval_status = 'pending'`),
    taskRequests: await count(
      `SELECT COUNT(*) c FROM task_requests r JOIN projects p ON p.id = r.project_id
        WHERE r.status = 'pending' AND ${OPEN_PROJECT}`
    ),
    finishedTasks: await count(
      `SELECT COUNT(*) c FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.status = 'review' AND t.signed_off_at IS NULL AND ${OPEN_PROJECT}`
    ),
    finishedSubtasks: await count(
      `SELECT COUNT(*) c FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
        WHERE s.status = 'review' AND t.signed_off_at IS NULL AND ${OPEN_PROJECT}`
    ),
    blockers: await count(
      `SELECT COUNT(*) c FROM task_dependencies d JOIN tasks t ON t.id = d.task_id JOIN projects p ON p.id = t.project_id
        WHERE d.status = 'pending' AND ${OPEN_PROJECT}`
    ),
    signOffs: await count(
      `SELECT COUNT(*) c FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.status = 'done' AND t.signed_off_at IS NULL AND ${OPEN_PROJECT}`
    ),
    // Every task signed off and nothing still asked for: only "Mark completed" is left.
    readyToClose: await count(
      `SELECT COUNT(*) c FROM projects p
        WHERE ${OPEN_PROJECT}
          AND EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id)
          AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.signed_off_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM task_requests r WHERE r.project_id = p.id AND r.status = 'pending')`
    ),
  };

  // Who finished work is waiting on: a subtask on its task's owner (or the
  // project owner when the task has none), a task on the project owner.
  const reviewers = (
    await query<DbRow[]>(
      `SELECT q.reviewer_id, u.name, COUNT(*) AS waiting, MIN(q.since) AS oldest
         FROM (
           SELECT COALESCE(t.assignee_id, p.owner_id) AS reviewer_id, s.submitted_at AS since
             FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
            WHERE s.status = 'review' AND t.signed_off_at IS NULL AND ${OPEN_PROJECT}
           UNION ALL
           SELECT p.owner_id AS reviewer_id, t.updated_at AS since
             FROM tasks t JOIN projects p ON p.id = t.project_id
            WHERE t.status = 'review' AND t.signed_off_at IS NULL AND ${OPEN_PROJECT}
         ) q
         LEFT JOIN users u ON u.id = q.reviewer_id
        GROUP BY q.reviewer_id, u.name
        ORDER BY waiting DESC, oldest ASC
        LIMIT 8`
    )
  ).map((r) => ({
    reviewer_id: r.reviewer_id ?? null,
    name: r.name ?? null,
    waiting: Number(r.waiting),
    oldest: r.oldest ?? null,
  }));

  // Open work per person: their subtasks, and their tasks that aren't split up.
  const loadRows = await query<DbRow[]>(
    `SELECT u.id, u.name, u.department, u.designation,
            (SELECT COUNT(*) FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
              WHERE s.assignee_id = u.id AND s.status IN ('todo','in_progress') AND t.status <> 'done' AND ${OPEN_PROJECT})
          + (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id
              WHERE t.assignee_id = u.id AND t.status IN ('todo','in_progress') AND NOT ${HAS_SUBTASKS} AND ${OPEN_PROJECT})
            AS open_items,
            (SELECT COUNT(*) FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
              WHERE s.assignee_id = u.id AND s.status IN ('todo','in_progress') AND t.status <> 'done'
                AND s.due_date < UTC_DATE() AND ${OPEN_PROJECT})
          + (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id
              WHERE t.assignee_id = u.id AND t.status IN ('todo','in_progress') AND NOT ${HAS_SUBTASKS}
                AND t.due_date < UTC_DATE() AND ${OPEN_PROJECT})
            AS overdue
       FROM users u
      WHERE u.is_active = 1 AND u.role <> 'admin'`
  );
  const everyone: PersonLoad[] = loadRows.map((r) => ({
    id: r.id,
    name: r.name,
    department: r.department || null,
    designation: r.designation || null,
    open_items: Number(r.open_items),
    overdue: Number(r.overdue),
  }));
  const people = everyone
    .filter((p) => p.open_items > 0)
    .sort((a, b) => b.open_items - a.open_items || b.overdue - a.overdue || a.name.localeCompare(b.name));
  const idle = everyone.filter((p) => p.open_items === 0).sort((a, b) => a.name.localeCompare(b.name));

  // Records worth fixing. Each one says how many, and shows a few.
  const dataIssues: DataIssue[] = [];
  const noDept = await query<DbRow[]>(
    `SELECT name FROM users WHERE is_active = 1 AND (department IS NULL OR department = '') ORDER BY name`
  );
  dataIssues.push({
    key: "no-department",
    label: "People with no department",
    count: noDept.length,
    href: "/admin/people",
    examples: noDept.slice(0, 4).map((r) => String(r.name)),
  });
  const departments = await query<DbRow[]>(
    `SELECT department AS name, COUNT(*) AS c FROM users
      WHERE is_active = 1 AND department IS NOT NULL AND department <> ''
      GROUP BY department`
  );
  const odd = departments.filter((d) => looksLikeCode(String(d.name)));
  dataIssues.push({
    key: "odd-department",
    label: "Department names that look like an ID or phone number",
    count: odd.reduce((n, d) => n + Number(d.c), 0),
    href: "/admin/people",
    examples: odd.slice(0, 4).map((d) => `${d.name} (${d.c})`),
  });
  const noDue = await query<DbRow[]>(
    `SELECT p.name FROM projects p WHERE ${OPEN_PROJECT} AND p.due_date IS NULL ORDER BY p.name`
  );
  dataIssues.push({
    key: "project-no-due",
    label: "Active projects with no due date (no schedule to track)",
    count: noDue.length,
    href: "/projects",
    examples: noDue.slice(0, 4).map((r) => String(r.name)),
  });
  const noOwnerProjects = await query<DbRow[]>(
    `SELECT p.name FROM projects p WHERE ${OPEN_PROJECT} AND p.owner_id IS NULL ORDER BY p.name`
  );
  dataIssues.push({
    key: "project-no-owner",
    label: "Active projects with no owner (nobody approves their tasks)",
    count: noOwnerProjects.length,
    href: "/projects",
    examples: noOwnerProjects.slice(0, 4).map((r) => String(r.name)),
  });
  const noOwnerTasks = await query<DbRow[]>(
    `SELECT t.title, p.name AS project FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE ${OPEN_PROJECT} AND t.status <> 'done' AND t.assignee_id IS NULL
      ORDER BY t.created_at`
  );
  dataIssues.push({
    key: "task-no-owner",
    label: "Open tasks with no owner",
    count: noOwnerTasks.length,
    href: "/projects",
    examples: noOwnerTasks.slice(0, 4).map((r) => `${r.title} · ${r.project}`),
  });

  return { portfolio, decisions, reviewers, people, idle, dataIssues };
}
