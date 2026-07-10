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

export interface HoursTotals {
  estimated: number;
  spent: number;
}

export interface ProjectProgress {
  id: number;
  name: string;
  task_count: number;
  done_count: number;
}

export interface AdminDashboard {
  totals: { users: number; projects: number; tasks: number; activeProjects: number };
  tasksByStatus: Record<TaskStatus, number>;
  outstandingCount: number;
  pendingApprovalCount: number;
  hours: HoursTotals;
  overdue: DbRow[];
  projectProgress: ProjectProgress[];
  upcomingMeetings: DbRow[];
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

  const [outstanding] = await query<DbRow[]>(
    `SELECT COUNT(*) AS c FROM tasks WHERE outstanding = 1`
  );
  const [pending] = await query<DbRow[]>(
    `SELECT COUNT(*) AS c FROM tasks WHERE approval_status = 'pending'`
  );
  const [hours] = await query<DbRow[]>(
    `SELECT COALESCE(SUM(estimated_hours),0) AS est,
            COALESCE(SUM(spent_hours),0) AS spent FROM tasks`
  );

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

  const projectProgress = await query<DbRow[]>(
    `SELECT p.id, p.name,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count
     FROM projects p
     WHERE p.status = 'active'
     ORDER BY task_count DESC, p.updated_at DESC
     LIMIT 6`
  );

  const upcomingMeetings = await query<DbRow[]>(
    `SELECT m.id, m.title, m.start_time, p.name AS project_name
     FROM meetings m LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.start_time > UTC_TIMESTAMP()
     ORDER BY m.start_time ASC LIMIT 5`
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
    outstandingCount: Number(outstanding.c),
    pendingApprovalCount: Number(pending.c),
    hours: { estimated: Number(hours.est), spent: Number(hours.spent) },
    overdue,
    projectProgress: projectProgress as unknown as ProjectProgress[],
    upcomingMeetings,
    recentActivity,
  };
}

export interface MemberDashboard {
  tasksByStatus: Record<TaskStatus, number>;
  openCount: number;
  overdueCount: number;
  outstandingCount: number;
  pendingApprovalCount: number;
  hours: HoursTotals;
  upcoming: DbRow[];
  upcomingMeetings: DbRow[];
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
  const [outstanding] = await query<DbRow[]>(
    `SELECT COUNT(*) AS c FROM tasks WHERE assignee_id = ? AND outstanding = 1`,
    [userId]
  );
  const [pending] = await query<DbRow[]>(
    `SELECT COUNT(*) AS c FROM tasks WHERE assignee_id = ? AND approval_status = 'pending'`,
    [userId]
  );
  const [hours] = await query<DbRow[]>(
    `SELECT COALESCE(SUM(estimated_hours),0) AS est,
            COALESCE(SUM(spent_hours),0) AS spent
     FROM tasks WHERE assignee_id = ?`,
    [userId]
  );
  const upcomingMeetings = await query<DbRow[]>(
    `SELECT m.id, m.title, m.start_time, p.name AS project_name
     FROM meetings m
     LEFT JOIN projects p ON p.id = m.project_id
     WHERE m.start_time > UTC_TIMESTAMP()
       AND (m.created_by = ? OR m.id IN (
         SELECT meeting_id FROM meeting_attendees WHERE user_id = ?
       ))
     ORDER BY m.start_time ASC LIMIT 5`,
    [userId, userId]
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
    outstandingCount: Number(outstanding.c),
    pendingApprovalCount: Number(pending.c),
    hours: { estimated: Number(hours.est), spent: Number(hours.spent) },
    upcoming,
    upcomingMeetings,
    projects,
  };
}
