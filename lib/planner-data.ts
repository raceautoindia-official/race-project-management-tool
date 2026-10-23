import "server-only";
import { query, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import type { PlannerPeriod } from "@/lib/planner";

/**
 * Whose planner you may read.
 *
 * Your own, always. An admin's reach is everyone. A project lead's is the
 * people on the projects they lead — they are the ones who have to know what
 * their team is doing this week.
 */
export const VISIBLE_USER_SQL = `(
  u.id = ?
  OR ? = 'admin'
  OR u.id IN (
    SELECT pm.user_id FROM project_members pm
     WHERE pm.project_id IN (
       SELECT led.project_id FROM project_members led
        WHERE led.user_id = ? AND led.role_in_project = 'lead'
     )
  )
)`;

export function visibleParams(user: User): [number, string, number] {
  return [user.id, user.role, user.id];
}

/** Can this person read that person's planner? */
export async function canReadPlanner(user: User, userId: number): Promise<boolean> {
  if (userId === user.id || user.role === "admin") return true;
  const rows = await query<DbRow[]>(
    `SELECT 1 FROM project_members pm
      WHERE pm.user_id = ?
        AND pm.project_id IN (
          SELECT led.project_id FROM project_members led
           WHERE led.user_id = ? AND led.role_in_project = 'lead'
        )
      LIMIT 1`,
    [userId, user.id]
  );
  return rows.length > 0;
}

export interface PlannerRow extends DbRow {
  user_id: number;
  user_name: string;
  period: PlannerPeriod;
  entry_date: string;
  plan: string | null;
  progress: string | null;
  updated_at: string;
}

/** Everyone's entries for one period, for the people this person may read. */
export async function plannerForPeriod(
  user: User,
  period: PlannerPeriod,
  entryDate: string
): Promise<PlannerRow[]> {
  return query<PlannerRow[]>(
    `SELECT e.user_id, u.name AS user_name, u.emp_id, e.period,
            DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_date,
            e.plan, e.progress, e.updated_at
       FROM planner_entries e
       JOIN users u ON u.id = e.user_id
      WHERE e.period = ? AND e.entry_date = ? AND ${VISIBLE_USER_SQL}
      ORDER BY u.name`,
    [period, entryDate, ...visibleParams(user)]
  );
}

/** One person's entries across a range, newest first. */
export async function plannerRange(
  userId: number,
  period: PlannerPeriod,
  from: string,
  to: string
): Promise<PlannerRow[]> {
  return query<PlannerRow[]>(
    `SELECT e.user_id, u.name AS user_name, u.emp_id, e.period,
            DATE_FORMAT(e.entry_date, '%Y-%m-%d') AS entry_date,
            e.plan, e.progress, e.updated_at
       FROM planner_entries e
       JOIN users u ON u.id = e.user_id
      WHERE e.user_id = ? AND e.period = ? AND e.entry_date BETWEEN ? AND ?
      ORDER BY e.entry_date DESC`,
    [userId, period, from, to]
  );
}

/** The people whose planners this person may read, for a picker. */
export async function readablePeople(user: User): Promise<DbRow[]> {
  return query<DbRow[]>(
    `SELECT u.id, u.name FROM users u
      WHERE u.is_active = TRUE AND ${VISIBLE_USER_SQL}
      ORDER BY u.name`,
    visibleParams(user)
  );
}
