import "server-only";
import { query, DbRow } from "./db";
import type { TaskStatus } from "./types";

export interface StatusCount {
  status: TaskStatus;
  count: number;
}

function emptyStatusCounts(): Record<TaskStatus, number> {
  return { todo: 0, in_progress: 0, review: 0, done: 0 };
}

export interface AdminDashboard {
  totals: { users: number; projects: number; tasks: number; activeProjects: number };
  tasksByStatus: Record<TaskStatus, number>;
  overdue: DbRow[];
  recentActivity: DbRow[];
}

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const [users] = await query<DbRow[]>(`SELECT COUNT(*) AS c FROM users`);
  const [projects] = await query<DbRow[]>(`SELECT COUNT(*) AS c FROM projects`);
  const [activeProjects] = await query<DbRow[]>(
    `SELECT COUNT(*) AS c FROM projects WHERE status = 'active'`
  );
  const [tasks] = await query<DbRow[]>(`SELECT COUNT(*) AS c FROM tasks`);

  const statusRows = await query<DbRow[]>(
    `SELECT status, COUNT(*) AS c FROM tasks GROUP BY status`
  );
  const tasksByStatus = emptyStatusCounts();
  for (const r of statusRows) {
    tasksByStatus[r.status as TaskStatus] = Number(r.c);
  }

  const overdue = await query<DbRow[]>(
    `SELECT t.id, t.title, t.due_date, t.status, t.priority, t.project_id,
            p.name AS project_name, a.name AS assignee_name
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     LEFT JOIN users a ON a.id = t.assignee_id
     WHERE t.due_date < CURDATE() AND t.status <> 'done'
     ORDER BY t.due_date ASC
     LIMIT 8`
  );

  const recentActivity = await query<DbRow[]>(
    `SELECT al.id, al.action, al.entity_type, al.entity_id, al.metadata,
            al.created_at, u.name AS user_name
     FROM activity_log al
     LEFT JOIN users u ON u.id = al.user_id
     ORDER BY al.created_at DESC, al.id DESC
     LIMIT 10`
  );

  return {
    totals: {
      users: Number(users.c),
      projects: Number(projects.c),
      tasks: Number(tasks.c),
      activeProjects: Number(activeProjects.c),
    },
    tasksByStatus,
    overdue,
    recentActivity,
  };
}

export interface MemberDashboard {
  tasksByStatus: Record<TaskStatus, number>;
  openCount: number;
  overdueCount: number;
  upcoming: DbRow[];
  projects: DbRow[];
}

export async function getMemberDashboard(
  userId: number
): Promise<MemberDashboard> {
  const statusRows = await query<DbRow[]>(
    `SELECT status, COUNT(*) AS c FROM tasks WHERE assignee_id = ? GROUP BY status`,
    [userId]
  );
  const tasksByStatus = emptyStatusCounts();
  for (const r of statusRows) {
    tasksByStatus[r.status as TaskStatus] = Number(r.c);
  }
  const openCount =
    tasksByStatus.todo + tasksByStatus.in_progress + tasksByStatus.review;

  const [overdue] = await query<DbRow[]>(
    `SELECT COUNT(*) AS c FROM tasks
     WHERE assignee_id = ? AND due_date < CURDATE() AND status <> 'done'`,
    [userId]
  );

  const upcoming = await query<DbRow[]>(
    `SELECT t.id, t.title, t.due_date, t.status, t.priority, t.project_id,
            p.name AS project_name
     FROM tasks t
     JOIN projects p ON p.id = t.project_id
     WHERE t.assignee_id = ? AND t.status <> 'done'
     ORDER BY (t.due_date IS NULL), t.due_date ASC
     LIMIT 6`,
    [userId]
  );

  const projects = await query<DbRow[]>(
    `SELECT p.id, p.name, p.status, pm.role_in_project,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
     FROM projects p
     JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
     ORDER BY p.updated_at DESC`,
    [userId]
  );

  return {
    tasksByStatus,
    openCount,
    overdueCount: Number(overdue.c),
    upcoming,
    projects,
  };
}
