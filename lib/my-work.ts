import { query, DbRow } from "./db";
import { attachTaskMeta } from "./tasks";
import { PROJECT_CREDITED_SQL, PROJECT_UNITS_SQL, projectPercent } from "./progress";
import type { User } from "./types";

/**
 * lib/my-work.ts — everything one person needs to act on, for My Work and
 * Reviews. It joins the redesign's flow (subtasks to do, subtasks and tasks to
 * review) with the workflows the app already had (sign-offs, project and task
 * requests, blocker requests), so nothing waiting on someone gets lost.
 *
 * "Manager of a project" = admin, lead, or owner (lib/permissions.ts).
 */

export interface WorkItem {
  kind: "subtask" | "task";
  id: number;
  task_id: number;
  title: string;
  task_title: string;
  project_id: number;
  project_name: string;
  status: string;
  start_date: string | null;
  due_date: string | null;
  person_id: number | null;
  person_name: string | null;
  submitted_at: string | null;
  changes_requested: string | null;
}

export interface OwnedTask {
  id: number;
  title: string;
  project_id: number;
  project_name: string;
  status: string;
  start_date: string | null;
  due_date: string | null;
  subtask_total: number;
  subtask_done: number;
  progress_approved: number;
  progress_pending: number;
  waiting_for_me: number;
  unassigned: number;
}

export interface OwnedProject {
  id: number;
  name: string;
  department: string | null;
  start_date: string | null;
  due_date: string | null;
  percent: number;
  task_count: number;
  ready_to_close: boolean;
}

export interface Attention {
  kind: "signoff" | "project_request" | "task_request" | "blocker";
  id: number;
  project_id: number;
  project_name: string;
  title: string;
  who: string | null;
  at: string | null;
  link: string;
}

export interface MyWork {
  todo: WorkItem[]; // my open subtasks + my tasks without subtasks
  submitted: WorkItem[]; // mine, waiting for someone's review
  reviewSubtasks: WorkItem[]; // subtasks waiting for me (I own the task)
  reviewTasks: WorkItem[]; // tasks waiting for a manager — me
  attention: Attention[]; // sign-offs, requests, blockers waiting for me
  ownedTasks: OwnedTask[];
  ownedProjects: OwnedProject[];
  recentlyApproved: WorkItem[]; // what I approved lately
}

/** Projects this person manages (admin: every open approved project). */
function managedProjectsSql(user: User): { sql: string; params: unknown[] } {
  if (user.role === "admin") return { sql: "SELECT id FROM projects", params: [] };
  return {
    sql: `SELECT id FROM projects WHERE owner_id = ?
          UNION SELECT project_id FROM project_members WHERE user_id = ? AND role_in_project = 'lead'`,
    params: [user.id, user.id],
  };
}

const OPEN_PROJECT = `p.approval_status = 'approved' AND p.status = 'active'`;

const SUBTASK_ITEM = `
  'subtask' AS kind, s.id, s.task_id, s.title, t.title AS task_title, t.project_id,
  p.name AS project_name, s.status, s.start_date, s.due_date,
  s.assignee_id AS person_id, u.name AS person_name, s.submitted_at, s.changes_requested`;

const TASK_ITEM = `
  'task' AS kind, t.id, t.id AS task_id, t.title, t.title AS task_title, t.project_id,
  p.name AS project_name, t.status, t.start_date, t.due_date,
  t.assignee_id AS person_id, u.name AS person_name, NULL AS submitted_at, NULL AS changes_requested`;

/** A task "has subtasks" when it has any that are not cancelled. */
const HAS_SUBTASKS = `EXISTS (SELECT 1 FROM subtasks x WHERE x.task_id = t.id AND x.status <> 'cancelled')`;

function asItems(rows: DbRow[]): WorkItem[] {
  return rows.map((r) => ({
    kind: r.kind,
    id: r.id,
    task_id: r.task_id,
    title: r.title,
    task_title: r.task_title,
    project_id: r.project_id,
    project_name: r.project_name,
    status: r.status,
    start_date: r.start_date ?? null,
    due_date: r.due_date ?? null,
    person_id: r.person_id ?? null,
    person_name: r.person_name ?? null,
    submitted_at: r.submitted_at ?? null,
    changes_requested: r.changes_requested ?? null,
  }));
}

export async function getMyWork(user: User): Promise<MyWork> {
  const managed = managedProjectsSql(user);

  // My open work: subtasks assigned to me, and my tasks that have no subtasks.
  const todo = asItems([
    ...(await query<DbRow[]>(
      `SELECT ${SUBTASK_ITEM}
         FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = s.assignee_id
        WHERE s.assignee_id = ? AND s.status IN ('todo','in_progress')
          AND t.signed_off_at IS NULL AND t.status <> 'done' AND ${OPEN_PROJECT}`,
      [user.id]
    )),
    ...(await query<DbRow[]>(
      `SELECT ${TASK_ITEM}
         FROM tasks t JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.assignee_id = ? AND t.status IN ('todo','in_progress') AND NOT ${HAS_SUBTASKS}
          AND t.signed_off_at IS NULL AND ${OPEN_PROJECT}`,
      [user.id]
    )),
  ]).sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));

  const submitted = asItems([
    ...(await query<DbRow[]>(
      `SELECT ${SUBTASK_ITEM}
         FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = t.assignee_id
        WHERE s.assignee_id = ? AND s.status = 'review' AND ${OPEN_PROJECT}`,
      [user.id]
    )),
    ...(await query<DbRow[]>(
      `SELECT ${TASK_ITEM}
         FROM tasks t JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.assignee_id = ? AND t.status = 'review' AND ${OPEN_PROJECT}`,
      [user.id]
    )),
  ]);

  // Subtasks waiting for me: I own their task (or it has no owner and I manage it).
  const reviewSubtasks = asItems(
    await query<DbRow[]>(
      `SELECT ${SUBTASK_ITEM}
         FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = s.assignee_id
        WHERE s.status = 'review' AND t.signed_off_at IS NULL AND ${OPEN_PROJECT}
          AND (t.assignee_id = ? OR (t.assignee_id IS NULL AND t.project_id IN (${managed.sql})))
        ORDER BY s.submitted_at ASC`,
      [user.id, ...managed.params]
    )
  );

  // Tasks waiting for a manager's approval (the same set as Outstanding's "review").
  const reviewTasks = asItems(
    await query<DbRow[]>(
      `SELECT ${TASK_ITEM}
         FROM tasks t JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.status = 'review' AND t.signed_off_at IS NULL AND ${OPEN_PROJECT}
          AND t.project_id IN (${managed.sql})
          AND (t.assignee_id IS NULL OR t.assignee_id <> ? OR ? = 'admin')
        ORDER BY t.updated_at ASC`,
      [...managed.params, user.id, user.role]
    )
  );

  // The workflows the app already had.
  const attention: Attention[] = [];
  for (const r of await query<DbRow[]>(
    `SELECT t.id, t.project_id, p.name AS project_name, t.title, u.name AS who, t.completed_at AS at
       FROM tasks t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.status = 'done' AND t.signed_off_at IS NULL AND t.requested_by = ? AND p.approval_status = 'approved'
      ORDER BY t.completed_at ASC`,
    [user.id]
  )) {
    attention.push({ kind: "signoff", id: r.id, project_id: r.project_id, project_name: r.project_name, title: r.title, who: r.who, at: r.at, link: `/projects/${r.project_id}/tasks/${r.id}` });
  }
  for (const r of await query<DbRow[]>(
    `SELECT p.id, p.id AS project_id, p.name AS project_name, p.name AS title, u.name AS who, p.requested_at AS at
       FROM projects p LEFT JOIN users u ON u.id = p.requested_by
      WHERE p.approval_status = 'pending' AND (p.owner_id = ? OR ? = 'admin')`,
    [user.id, user.role]
  )) {
    attention.push({ kind: "project_request", id: r.id, project_id: r.project_id, project_name: r.project_name, title: r.title, who: r.who, at: r.at, link: `/projects/${r.id}` });
  }
  for (const r of await query<DbRow[]>(
    `SELECT r.id, r.project_id, p.name AS project_name, r.title, u.name AS who, r.requested_at AS at
       FROM task_requests r JOIN projects p ON p.id = r.project_id LEFT JOIN users u ON u.id = r.requested_by
      WHERE r.status = 'pending' AND r.project_id IN (${managed.sql}) AND (r.requested_by <> ? OR ? = 'admin')`,
    [...managed.params, user.id, user.role]
  )) {
    attention.push({ kind: "task_request", id: r.id, project_id: r.project_id, project_name: r.project_name, title: r.title, who: r.who, at: r.at, link: `/projects/${r.project_id}` });
  }
  for (const r of await query<DbRow[]>(
    `SELECT d.task_id AS id, t.project_id, p.name AS project_name, t.title, u.name AS who, d.created_at AS at
       FROM task_dependencies d JOIN tasks t ON t.id = d.task_id JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = d.requested_by
      WHERE d.status = 'pending' AND t.project_id IN (${managed.sql})`,
    managed.params
  )) {
    attention.push({ kind: "blocker", id: r.id, project_id: r.project_id, project_name: r.project_name, title: r.title, who: r.who, at: r.at, link: `/projects/${r.project_id}/tasks/${r.id}` });
  }

  // Tasks I own that are split into subtasks.
  const ownedRows = await query<DbRow[]>(
    `SELECT t.id, t.title, t.project_id, p.name AS project_name, t.status, t.start_date, t.due_date
       FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? AND t.status <> 'done' AND ${HAS_SUBTASKS} AND ${OPEN_PROJECT}
      ORDER BY (t.due_date IS NULL), t.due_date`,
    [user.id]
  );
  await attachTaskMeta(ownedRows);
  const counts = ownedRows.length
    ? await query<DbRow[]>(
        `SELECT task_id, SUM(status = 'review') AS waiting,
                SUM(assignee_id IS NULL AND status <> 'cancelled') AS unassigned
           FROM subtasks WHERE task_id IN (${ownedRows.map(() => "?").join(",")}) GROUP BY task_id`,
        ownedRows.map((r) => r.id)
      )
    : [];
  const ownedTasks: OwnedTask[] = ownedRows.map((r) => {
    const c = counts.find((x) => x.task_id === r.id);
    return {
      id: r.id,
      title: r.title,
      project_id: r.project_id,
      project_name: r.project_name,
      status: r.status,
      start_date: r.start_date ?? null,
      due_date: r.due_date ?? null,
      subtask_total: Number(r.subtask_total ?? 0),
      subtask_done: Number(r.subtask_done ?? 0),
      progress_approved: Number(r.progress_approved ?? 0),
      progress_pending: Number(r.progress_pending ?? 0),
      waiting_for_me: Number(c?.waiting ?? 0),
      unassigned: Number(c?.unassigned ?? 0),
    };
  });

  // Projects I own.
  const projRows = await query<DbRow[]>(
    `SELECT p.id, p.name, p.department, p.start_date, p.due_date,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.signed_off_at IS NULL) AS unsigned_count,
            (SELECT COUNT(*) FROM task_requests r WHERE r.project_id = p.id AND r.status = 'pending') AS pending_requests,
            ${PROJECT_UNITS_SQL} AS units, ${PROJECT_CREDITED_SQL} AS credited
       FROM projects p
      WHERE p.owner_id = ? AND ${OPEN_PROJECT}
      ORDER BY (p.due_date IS NULL), p.due_date`,
    [user.id]
  );
  const ownedProjects: OwnedProject[] = projRows.map((r) => ({
    id: r.id,
    name: r.name,
    department: r.department ?? null,
    start_date: r.start_date ?? null,
    due_date: r.due_date ?? null,
    percent: projectPercent({ units: Number(r.units), credited: Number(r.credited) }),
    task_count: Number(r.task_count),
    // The same test as "Mark completed": every task signed off, no requests open.
    ready_to_close: Number(r.task_count) > 0 && Number(r.unsigned_count) === 0 && Number(r.pending_requests) === 0,
  }));

  const recentlyApproved = asItems(
    await query<DbRow[]>(
      `SELECT ${SUBTASK_ITEM}
         FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = s.assignee_id
        WHERE s.approved_by = ? AND s.status = 'done' AND s.approved_at > UTC_TIMESTAMP() - INTERVAL 14 DAY
        ORDER BY s.approved_at DESC LIMIT 20`,
      [user.id]
    )
  );

  return { todo, submitted, reviewSubtasks, reviewTasks, attention, ownedTasks, ownedProjects, recentlyApproved };
}
