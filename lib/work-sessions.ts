import "server-only";
import { query, DbRow, DbResult } from "./db";
import { parseUtc, toSqlUtc } from "./attendance-clock";

/**
 * lib/work-sessions.ts — ending stretches of work (lib/work-timer.ts) and
 * logging their minutes. Kept free of the task and subtask modules so those
 * can stop timers without importing the timer.
 */

export type EndReason = "paused" | "switched" | "clocked_out" | "finished" | "retired";

export interface SessionRef {
  id: number;
  user_id: number;
  task_id: number;
  subtask_id: number | null;
  started_at: string;
}

/** Keep tasks.spent_hours equal to everything logged against the task. */
export async function recomputeSpentHours(taskId: number): Promise<void> {
  await query(
    `UPDATE tasks
       SET spent_hours = (
         SELECT COALESCE(SUM(minutes), 0) / 60 FROM task_time_logs WHERE task_id = ?
       )
     WHERE id = ?`,
    [taskId, taskId]
  );
}

/**
 * End one stretch of work at `endAt` and log its minutes. Guarded on the
 * session still being open, so two closers can't both log it. Returns the
 * minutes logged (0 when someone else closed it first).
 */
export async function closeSession(session: SessionRef, endAt: string, reason: EndReason): Promise<number> {
  const start = parseUtc(session.started_at);
  const end = parseUtc(endAt) < start ? start : parseUtc(endAt);
  const minutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60_000));
  const res = (await query<DbResult>(
    `UPDATE work_sessions SET ended_at = ?, end_reason = ?, minutes = ? WHERE id = ? AND ended_at IS NULL`,
    [toSqlUtc(end), reason, minutes, session.id]
  )) as unknown as DbResult;
  if (res.affectedRows === 0) return 0;
  if (minutes > 0) {
    await query(
      `INSERT INTO task_time_logs (task_id, user_id, minutes, note, source, session_id, subtask_id, logged_at)
       VALUES (?, ?, ?, ?, 'timer', ?, ?, ?)`,
      [session.task_id, session.user_id, minutes, "Work timer", session.id, session.subtask_id, session.started_at]
    );
    await recomputeSpentHours(session.task_id);
  }
  return minutes;
}

export async function openSessions(where: string, params: unknown[]): Promise<DbRow[]> {
  return query<DbRow[]>(
    `SELECT ws.id, ws.user_id, ws.task_id, ws.subtask_id, ws.started_at
       FROM work_sessions ws
      WHERE ws.ended_at IS NULL AND ${where}`,
    params
  );
}

export function asSession(r: DbRow): SessionRef {
  return {
    id: Number(r.id),
    user_id: Number(r.user_id),
    task_id: Number(r.task_id),
    subtask_id: r.subtask_id == null ? null : Number(r.subtask_id),
    started_at: String(r.started_at),
  };
}

/**
 * Stop every timer on a task (or one subtask) that can no longer be worked
 * on — sent for review, finished, cancelled or locked.
 */
export async function stopWorkOn(target: { taskId: number } | { subtaskId: number }, now = new Date()): Promise<void> {
  const rows =
    "taskId" in target
      ? await openSessions("ws.task_id = ?", [target.taskId])
      : await openSessions("ws.subtask_id = ?", [target.subtaskId]);
  for (const r of rows) await closeSession(asSession(r), toSqlUtc(now), "finished");
}
