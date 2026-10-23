import "server-only";
import { query, DbRow } from "./db";
import { attachTaskMeta } from "./tasks";
import { PROJECT_CREDITED_SQL, PROJECT_UNITS_SQL, projectPercent } from "./progress";
import type { OutstandingTask } from "@/components/OutstandingView";
import type { Task, User } from "./types";

/**
 * lib/work-views.ts — the data behind the views that moved into the
 * redesign's pages: My Tasks (now a tab of My Work), Outstanding (now the
 * "Overdue & in review" tab of Reviews) and the per-project progress report.
 * The queries are the ones those pages ran before, unchanged.
 */

/** My Tasks: my own tasks, plus live work on my projects owned by others. */
export async function getMyTasksData(user: User): Promise<{ tasks: Task[]; projectTasks: Task[] }> {
  const rows = await query<DbRow[]>(
    `SELECT t.id, t.project_id, t.title, t.status, t.priority, t.due_date,
            p.name AS project_name, p.department
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE t.assignee_id = ?
     ORDER BY (t.due_date IS NULL), t.due_date ASC`,
    [user.id]
  );
  await attachTaskMeta(rows);

  // Live work in the projects this person belongs to, owned by someone else.
  // Membership is still the boundary — this shows what is going on around
  // you, not everything in the company.
  const teamRows = await query<DbRow[]>(
    `SELECT t.id, t.project_id, t.title, t.status, t.priority, t.due_date,
            p.name AS project_name, p.department, u.name AS assignee_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users u ON u.id = t.assignee_id
      WHERE t.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
        AND (t.assignee_id IS NULL OR t.assignee_id <> ?)
        AND t.signed_off_at IS NULL
        AND t.status <> 'done'
        AND p.status <> 'archived'
      ORDER BY (t.due_date IS NULL), t.due_date ASC, t.id`,
    [user.id, user.id]
  );
  await attachTaskMeta(teamRows);
  return { tasks: rows as unknown as Task[], projectTasks: teamRows as unknown as Task[] };
}

/** Outstanding: overdue tasks and tasks submitted for review that this person can act on. */
export async function getOutstandingTasks(user: User): Promise<OutstandingTask[]> {
  const isAdmin = user.role === "admin";
  const where = [
    "(t.outstanding = 1 OR t.status = 'review')",
    // Read-only projects (pending/rejected requests, completed) need no action.
    "p.approval_status = 'approved' AND p.status <> 'completed'",
  ];
  const params: unknown[] = [];
  if (!isAdmin) {
    where.push(`(
      t.assignee_id = ?
      OR t.project_id IN (
        SELECT project_id FROM project_members
        WHERE user_id = ? AND role_in_project = 'lead'
      )
    )`);
    params.push(user.id, user.id);
  }

  const rows = await query<DbRow[]>(
    `SELECT t.id, t.project_id, t.title, t.status, t.outstanding,
            t.approval_status, t.due_date, t.assignee_id,
            p.name AS project_name, p.department, a.name AS assignee_name,
            DATEDIFF(UTC_DATE(), t.due_date) AS days_overdue
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN users a ON a.id = t.assignee_id
      WHERE ${where.join(" AND ")}
      ORDER BY (t.status = 'review') DESC, t.due_date ASC`,
    params
  );

  // Project ids the (non-admin) user leads, for per-row approve/reject rights.
  let leadIds = new Set<number>();
  if (!isAdmin) {
    const lp = await query<DbRow[]>(
      `SELECT project_id FROM project_members
        WHERE user_id = ? AND role_in_project = 'lead'`,
      [user.id]
    );
    leadIds = new Set(lp.map((r) => r.project_id as number));
  }

  return rows.map((t) => ({
    id: t.id,
    project_id: t.project_id,
    title: t.title,
    project_name: t.project_name,
    department: (t.department as string | null) ?? null,
    assignee_name: t.assignee_name,
    due_date: t.due_date,
    status: t.status,
    outstanding: Boolean(t.outstanding),
    approval_status: t.approval_status,
    days_overdue: t.days_overdue != null ? Number(t.days_overdue) : null,
    can_manage: isAdmin || leadIds.has(t.project_id),
  }));
}

export interface ProjectProgressRow {
  id: number;
  name: string;
  department: string | null;
  owner_name: string | null;
  start_date: string | null;
  due_date: string | null;
  /** Approved (weighted) progress, 0–100. */
  percent: number;
  task_count: number;
  done_count: number;
  review_count: number;
  overdue_count: number;
}

/**
 * Reports › Progress: every active project an admin can see, or the ones a
 * member belongs to — the same scope as the old dashboards.
 */
export async function getProjectProgressRows(user: User): Promise<ProjectProgressRow[]> {
  const scope = user.role === "admin" ? "" : "AND p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)";
  const rows = await query<DbRow[]>(
    `SELECT p.id, p.name, p.department, p.start_date, p.due_date, o.name AS owner_name,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'review') AS review_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status <> 'done'
                AND t.due_date < UTC_DATE()) AS overdue_count,
            ${PROJECT_UNITS_SQL} AS units, ${PROJECT_CREDITED_SQL} AS credited
       FROM projects p LEFT JOIN users o ON o.id = p.owner_id
      WHERE p.status = 'active' AND p.approval_status = 'approved' ${scope}
      ORDER BY p.name`,
    user.role === "admin" ? [] : [user.id]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    department: r.department || null,
    owner_name: r.owner_name ?? null,
    start_date: r.start_date ?? null,
    due_date: r.due_date ?? null,
    percent: projectPercent({ units: Number(r.units), credited: Number(r.credited) }),
    task_count: Number(r.task_count),
    done_count: Number(r.done_count),
    review_count: Number(r.review_count),
    overdue_count: Number(r.overdue_count),
  }));
}
