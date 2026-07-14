import "server-only";
import { query, DbRow } from "./db";
import type { User } from "./types";

/**
 * lib/performance.ts — per-user performance & individual status tracking.
 *
 * Scope rules:
 *   admin  → every active user
 *   lead   → members of the projects they lead (plus themselves)
 *   member → themselves only
 *
 * All windows are the last 30 days; "on-time" = DATE(completed_at) <= due_date.
 */

export interface MemberStats {
  id: number;
  emp_id: string;
  name: string;
  role: "admin" | "member";
  online: boolean;
  last_seen_at: string | null;
  open_tasks: number;
  in_progress: number;
  in_review: number;
  overdue_now: number;
  completed_30d: number;
  ontime_30d: number;
  due_completed_30d: number; // completed tasks that had a due date (on-time denominator)
  minutes_30d: number;
  est_done_30d: number; // estimated hours on completed tasks (with estimates)
  spent_done_30d: number; // spent hours on those same tasks
  working_on: { id: number; title: string; project_id: number; project_name: string }[];
}

export interface TeamPerformance {
  scope: "all" | "led" | "self";
  members: MemberStats[];
}

async function scopedUserIds(user: User): Promise<{ scope: TeamPerformance["scope"]; ids: number[] | null }> {
  if (user.role === "admin") return { scope: "all", ids: null };
  const led = await query<DbRow[]>(
    `SELECT DISTINCT pm2.user_id
       FROM project_members pm
       JOIN project_members pm2 ON pm2.project_id = pm.project_id
      WHERE pm.user_id = ? AND pm.role_in_project = 'lead'`,
    [user.id]
  );
  const ids = new Set<number>(led.map((r) => r.user_id as number));
  ids.add(user.id);
  return { scope: led.length > 0 ? "led" : "self", ids: [...ids] };
}

export async function getTeamPerformance(user: User): Promise<TeamPerformance> {
  const { scope, ids } = await scopedUserIds(user);
  const whereScope = ids ? `AND u.id IN (${ids.map(() => "?").join(",")})` : "";
  const params = ids ?? [];

  const rows = await query<DbRow[]>(
    `SELECT u.id, u.emp_id, u.name, u.role, u.last_seen_at,
            (u.last_seen_at IS NOT NULL
              AND u.last_seen_at >= UTC_TIMESTAMP() - INTERVAL 5 MINUTE) AS online,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id
              AND t.status IN ('todo','in_progress','review')) AS open_tasks,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id
              AND t.status = 'in_progress') AS in_progress,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id
              AND t.status = 'review') AS in_review,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id
              AND t.status <> 'done' AND t.due_date IS NOT NULL
              AND t.due_date < UTC_DATE()) AS overdue_now,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id
              AND t.status = 'done'
              AND t.completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY) AS completed_30d,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id
              AND t.status = 'done'
              AND t.completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
              AND t.due_date IS NOT NULL
              AND DATE(t.completed_at) <= t.due_date) AS ontime_30d,
            (SELECT COUNT(*) FROM tasks t WHERE t.assignee_id = u.id
              AND t.status = 'done'
              AND t.completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
              AND t.due_date IS NOT NULL) AS due_completed_30d,
            (SELECT COALESCE(SUM(l.minutes),0) FROM task_time_logs l
              WHERE l.user_id = u.id
              AND l.logged_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY) AS minutes_30d,
            (SELECT COALESCE(SUM(t.estimated_hours),0) FROM tasks t
              WHERE t.assignee_id = u.id AND t.status = 'done'
              AND t.completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
              AND t.estimated_hours IS NOT NULL) AS est_done_30d,
            (SELECT COALESCE(SUM(t.spent_hours),0) FROM tasks t
              WHERE t.assignee_id = u.id AND t.status = 'done'
              AND t.completed_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY
              AND t.estimated_hours IS NOT NULL) AS spent_done_30d
       FROM users u
      WHERE u.is_active = TRUE ${whereScope}
      ORDER BY u.name`,
    params
  );

  // Individual status: what each person is working on right now.
  const userIds = rows.map((r) => r.id as number);
  const workingByUser = new Map<number, MemberStats["working_on"]>();
  if (userIds.length > 0) {
    const ph = userIds.map(() => "?").join(",");
    const wip = await query<DbRow[]>(
      `SELECT t.id, t.title, t.assignee_id, t.project_id, p.name AS project_name
         FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.assignee_id IN (${ph}) AND t.status = 'in_progress'
        ORDER BY t.updated_at DESC`,
      userIds
    );
    for (const w of wip) {
      const arr = workingByUser.get(w.assignee_id) ?? [];
      if (arr.length < 3) {
        arr.push({
          id: w.id,
          title: w.title,
          project_id: w.project_id,
          project_name: w.project_name,
        });
      }
      workingByUser.set(w.assignee_id, arr);
    }
  }

  const members: MemberStats[] = rows.map((r) => ({
    id: r.id,
    emp_id: r.emp_id,
    name: r.name,
    role: r.role,
    online: Boolean(Number(r.online)),
    last_seen_at: r.last_seen_at,
    open_tasks: Number(r.open_tasks),
    in_progress: Number(r.in_progress),
    in_review: Number(r.in_review),
    overdue_now: Number(r.overdue_now),
    completed_30d: Number(r.completed_30d),
    ontime_30d: Number(r.ontime_30d),
    due_completed_30d: Number(r.due_completed_30d),
    minutes_30d: Number(r.minutes_30d),
    est_done_30d: Number(r.est_done_30d),
    spent_done_30d: Number(r.spent_done_30d),
    working_on: workingByUser.get(r.id as number) ?? [],
  }));

  return { scope, members };
}

/** On-time completion % (null when no completed tasks had a due date). */
export function ontimePct(m: MemberStats): number | null {
  if (m.due_completed_30d === 0) return null;
  return Math.round((m.ontime_30d / m.due_completed_30d) * 100);
}

/** Effort vs estimate % on completed work (100 = on estimate, >100 = over). */
export function effortPct(m: MemberStats): number | null {
  if (m.est_done_30d <= 0) return null;
  return Math.round((m.spent_done_30d / m.est_done_30d) * 100);
}
