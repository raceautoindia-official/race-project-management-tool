import "server-only";
import { query, DbRow, DbResult } from "./db";
import { ApiError, conflict, forbidden } from "./http";
import { assertTaskWritable } from "./rbac";
import { logActivity, notify } from "./activity";
import { fetchClockRows } from "./attendance";
import {
  clockStateFrom,
  latestRow,
  parseUtc,
  timerStopAt,
  toSqlUtc,
  type ClockRow,
  type ClockState,
} from "./attendance-clock";
import { isManager, isTaskOwner } from "./permissions";
import { assertCan, loadSubtaskContext, loadTaskContext, subtaskLink } from "./subtasks";
import { applySubtaskAction } from "./subtask-actions";
import { formatIstTime } from "./tz";
import { asSession, closeSession, openSessions, type EndReason } from "./work-sessions";
import type { User } from "./types";

export { recomputeSpentHours, stopWorkOn, type EndReason } from "./work-sessions";

/**
 * lib/work-timer.ts — the work timer, tied to the Attendance clock.
 *
 * - Starting work on a task or subtask starts a timer, and moves the item to
 *   In progress. Only someone clocked in on the Attendance app may start.
 * - One timer per person: starting another stops the first ("switched").
 * - Clocking out on Attendance stops it at the clock-out time, wherever PM
 *   notices it — a page load (once a minute), the timer chip's poll, or the
 *   work-timers cron. Clocking back in does not restart it; they Resume.
 * - Sending an item for review, finishing or locking it stops its timers.
 *
 * When a stretch ends its minutes are written to task_time_logs (source
 * 'timer'), so every report that reads logged time includes it unchanged.
 */

export interface RunningTimer {
  sessionId: number;
  taskId: number;
  subtaskId: number | null;
  taskTitle: string;
  subtaskTitle: string | null;
  projectId: number;
  projectName: string;
  startedAt: string;
}

const NOT_CLOCKED_IN_MESSAGE =
  "You're not clocked in on the Attendance app. Clock in there first, then start work here.";
const ATTENDANCE_DOWN_MESSAGE =
  "PM couldn't reach the Attendance app to check that you're clocked in. Try again in a minute.";

/** The IST calendar date of a moment, "YYYY-MM-DD". */
export function istDay(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function dayBefore(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Clock rows for these employees, grouped by employee, from `fromDate` on. */
export async function clockRowsFor(employeeIds: number[], fromDate: string): Promise<Map<number, ClockRow[]>> {
  const rows = await fetchClockRows(employeeIds, fromDate);
  const out = new Map<number, ClockRow[]>();
  for (const r of rows) {
    const list = out.get(r.employee_id) ?? [];
    list.push(r);
    out.set(r.employee_id, list);
  }
  return out;
}

/** Where someone stands on the Attendance clock right now; null if unreachable. */
export async function clockStateOf(employeeId: number, now = new Date()): Promise<ClockState | null> {
  try {
    const rows = (await clockRowsFor([employeeId], dayBefore(istDay(now)))).get(employeeId) ?? [];
    return clockStateFrom(latestRow(rows), now);
  } catch (err) {
    console.error("[work-timer] attendance unavailable:", (err as Error).message);
    return null;
  }
}

async function employeeIdOf(userId: number): Promise<number> {
  const [row] = await query<DbRow[]>(`SELECT employee_id FROM users WHERE id = ? LIMIT 1`, [userId]);
  return Number(row?.employee_id ?? 0);
}

const RUNNING_SELECT = `
  SELECT ws.id, ws.user_id, ws.task_id, ws.subtask_id, ws.started_at,
         t.title AS task_title, s.title AS subtask_title,
         p.id AS project_id, p.name AS project_name
    FROM work_sessions ws
    JOIN tasks t ON t.id = ws.task_id
    JOIN projects p ON p.id = t.project_id
    LEFT JOIN subtasks s ON s.id = ws.subtask_id`;

function toRunning(r: DbRow): RunningTimer {
  return {
    sessionId: Number(r.id),
    taskId: Number(r.task_id),
    subtaskId: r.subtask_id == null ? null : Number(r.subtask_id),
    taskTitle: String(r.task_title),
    subtaskTitle: (r.subtask_title as string | null) ?? null,
    projectId: Number(r.project_id),
    projectName: String(r.project_name),
    startedAt: String(r.started_at),
  };
}

export async function runningTimerOf(userId: number): Promise<RunningTimer | null> {
  const [row] = await query<DbRow[]>(`${RUNNING_SELECT} WHERE ws.user_id = ? AND ws.ended_at IS NULL LIMIT 1`, [userId]);
  return row ? toRunning(row) : null;
}

/** Stop this person's timer, if one is running. Returns the minutes logged. */
export async function pauseWork(user: User, reason: EndReason = "paused", now = new Date()): Promise<number> {
  const [open] = await openSessions("ws.user_id = ?", [user.id]);
  if (!open) return 0;
  const minutes = await closeSession(asSession(open), toSqlUtc(now), reason);
  await logActivity({
    userId: user.id,
    action: "work.paused",
    entityType: "task",
    entityId: Number(open.task_id),
    metadata: { subtaskId: open.subtask_id ?? null, minutes, reason },
  });
  return minutes;
}

/**
 * Start (or resume) work on a task or one of its subtasks. Checks the caller
 * may work on it, that it is open for work, and that they are clocked in.
 */
export async function startWork(
  user: User,
  target: { taskId: number; subtaskId?: number | null },
  now = new Date()
): Promise<RunningTimer> {
  let taskId = target.taskId;
  const subtaskId = target.subtaskId ?? null;
  let subStatus: string | null = null;
  let taskStatus: string;

  if (subtaskId) {
    const { sub, task, ctx } = await loadSubtaskContext(user, subtaskId);
    if (taskId && Number(sub.task_id) !== taskId) throw new ApiError(400, "That subtask belongs to another task");
    taskId = task.id;
    assertCan("subtask.work", ctx);
    subStatus = String(sub.status);
    taskStatus = task.status;
    if (subStatus !== "todo" && subStatus !== "in_progress") {
      throw conflict(
        subStatus === "review"
          ? "This subtask is waiting for review. Pull it back before working on it again."
          : "This subtask is finished — reopen it to work on it again."
      );
    }
  } else {
    const { task, ctx } = await loadTaskContext(user, taskId);
    if (!isManager(ctx) && !isTaskOwner(ctx)) {
      throw forbidden("Only the task owner, the project owner, a lead or an admin can work on this task. Start one of its subtasks instead.");
    }
    taskStatus = task.status;
  }
  if (taskStatus !== "todo" && taskStatus !== "in_progress") {
    throw conflict(
      taskStatus === "review"
        ? "This task is waiting for review — it can't take more work until it is sent back."
        : "This task is approved — ask a lead to reopen it before working on it."
    );
  }
  await assertTaskWritable(taskId);

  // The rule this whole feature hangs on: no clock-in, no timer.
  const state = await clockStateOf(await employeeIdOf(user.id), now);
  if (!state) throw new ApiError(503, ATTENDANCE_DOWN_MESSAGE);
  if (!state.clockedIn) throw conflict(NOT_CLOCKED_IN_MESSAGE);

  const [open] = await openSessions("ws.user_id = ?", [user.id]);
  if (open) {
    if (Number(open.task_id) === taskId && (open.subtask_id == null ? null : Number(open.subtask_id)) === subtaskId) {
      return (await runningTimerOf(user.id))!;
    }
    await closeSession(asSession(open), toSqlUtc(now), "switched");
  }

  try {
    await query(
      `INSERT INTO work_sessions (user_id, task_id, subtask_id, started_at) VALUES (?, ?, ?, ?)`,
      [user.id, taskId, subtaskId, toSqlUtc(now)]
    );
  } catch (err) {
    if ((err as { code?: string }).code === "ER_DUP_ENTRY") {
      throw conflict("A timer was just started for you elsewhere — reload and try again.");
    }
    throw err;
  }

  // Starting work is what moves an item to In progress.
  if (subtaskId && subStatus === "todo") {
    await applySubtaskAction(user, subtaskId, "start");
  } else if (!subtaskId && taskStatus === "todo") {
    const res = (await query<DbResult>(
      `UPDATE tasks SET status = 'in_progress' WHERE id = ? AND status = 'todo' AND signed_off_at IS NULL`,
      [taskId]
    )) as unknown as DbResult;
    if (res.affectedRows) {
      await logActivity({
        userId: user.id,
        action: "task.status_changed",
        entityType: "task",
        entityId: taskId,
        metadata: { from: "todo", to: "in_progress", reason: "timer" },
      });
    }
  }

  await logActivity({
    userId: user.id,
    action: "work.started",
    entityType: "task",
    entityId: taskId,
    metadata: { subtaskId },
  });
  return (await runningTimerOf(user.id))!;
}

export interface ReconcileResult {
  stopped: { userId: number; sessionId: number; reason: EndReason; at: string; minutes: number }[];
  /** True when Attendance couldn't be read, so clock-outs weren't checked. */
  attendanceUnavailable: boolean;
}

/**
 * Stop timers that should no longer run: their person clocked out, left,
 * or the work is no longer open. Safe to call often and from anywhere;
 * `userIds` narrows it to some people (the page-load check passes one).
 */
export async function reconcileTimers(
  opts: { userIds?: number[]; now?: Date } = {}
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const result: ReconcileResult = { stopped: [], attendanceUnavailable: false };
  const scope = opts.userIds?.length ? ` AND ws.user_id IN (${opts.userIds.map(() => "?").join(",")})` : "";
  const open = await query<DbRow[]>(
    `SELECT ws.id, ws.user_id, ws.task_id, ws.subtask_id, ws.started_at,
            u.employee_id, u.is_active, t.status AS task_status, t.signed_off_at, t.title AS task_title,
            t.project_id, p.status AS project_status, p.approval_status AS project_approval,
            s.status AS subtask_status, s.title AS subtask_title
       FROM work_sessions ws
       JOIN users u ON u.id = ws.user_id
       JOIN tasks t ON t.id = ws.task_id
       JOIN projects p ON p.id = t.project_id
       LEFT JOIN subtasks s ON s.id = ws.subtask_id
      WHERE ws.ended_at IS NULL${scope}`,
    opts.userIds ?? []
  );
  if (!open.length) return result;

  const nowSql = toSqlUtc(now);
  const waiting: DbRow[] = [];
  for (const r of open) {
    let reason: EndReason | null = null;
    if (!Number(r.is_active)) reason = "retired";
    else if (
      r.signed_off_at ||
      (r.task_status !== "todo" && r.task_status !== "in_progress") ||
      r.project_status !== "active" ||
      r.project_approval !== "approved" ||
      (r.subtask_id != null && r.subtask_status !== "todo" && r.subtask_status !== "in_progress")
    ) {
      reason = "finished";
    }
    if (reason) {
      const minutes = await closeSession(asSession(r), nowSql, reason);
      result.stopped.push({ userId: Number(r.user_id), sessionId: Number(r.id), reason, at: nowSql, minutes });
    } else {
      waiting.push(r);
    }
  }
  if (!waiting.length) return result;

  const earliest = waiting.reduce((d, r) => {
    const day = istDay(parseUtc(String(r.started_at)));
    return day < d ? day : d;
  }, istDay(now));
  let rowsByEmployee: Map<number, ClockRow[]>;
  try {
    rowsByEmployee = await clockRowsFor(
      Array.from(new Set(waiting.map((r) => Number(r.employee_id)))),
      dayBefore(earliest)
    );
  } catch (err) {
    // Can't tell who clocked out: leave the timers running rather than guess.
    console.error("[work-timer] attendance unavailable:", (err as Error).message);
    result.attendanceUnavailable = true;
    return result;
  }

  for (const r of waiting) {
    const startedAt = String(r.started_at);
    const startDay = dayBefore(istDay(parseUtc(startedAt)));
    const rows = (rowsByEmployee.get(Number(r.employee_id)) ?? []).filter((x) => x.work_date >= startDay);
    const stopAt = timerStopAt(rows, startedAt, now);
    if (!stopAt) continue;
    const minutes = await closeSession(asSession(r), stopAt, "clocked_out");
    result.stopped.push({ userId: Number(r.user_id), sessionId: Number(r.id), reason: "clocked_out", at: stopAt, minutes });
    const what = r.subtask_title ? `"${r.subtask_title}"` : `"${r.task_title}"`;
    await notify(
      Number(r.user_id),
      "work_paused",
      `Your timer on ${what} stopped at ${formatIstTime(stopAt)} because you clocked out on Attendance. Press Resume when you're back.`,
      subtaskLink(Number(r.project_id), Number(r.task_id), r.subtask_id == null ? undefined : Number(r.subtask_id)),
      { whatsapp: false }
    );
  }
  return result;
}
