import "server-only";
import { query, DbRow, DbResult } from "./db";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { logActivity, notify } from "./activity";
import { getProjectRole } from "./rbac";
import {
  addDays,
  describeSchedule,
  fallsOn,
  parseWeekdays,
  place,
  upcoming,
  weekdayOf,
  type Frequency,
  type Schedule,
  type Weekday,
} from "./recurrence";
import { forPerson, loadWorkCalendar, type WorkCalendar } from "./workdays";
import type { User } from "./types";

/**
 * lib/recurring.ts — recurring work: rules, their approval, and the copies
 * they make.
 *
 * A rule is a task blueprint (title, owner, priority, estimate, subtasks with
 * their own assignees) plus a schedule (lib/recurrence.ts). Each copy is an
 * ordinary task in the rule's project and goes through the normal flow —
 * subtasks, the work timer, review — unless the admin who approved the rule
 * said no review is needed, in which case marking it complete finishes and
 * signs it off at once (tasks.auto_approve).
 *
 * - Anyone on a project may propose a rule; it waits for an admin, who
 *   approves it once and picks the review mode then. An admin's own rule is
 *   approved as it is made. A rule may ask for a new project of its own; the
 *   approval creates it.
 * - Copies follow the owner's working days and holidays in WorkLens
 *   (lib/workdays.ts). Copies are weighted 0, so routine work never moves a
 *   project's progress bar.
 * - If the last copy is still open (To do / In progress), the rule makes no
 *   new one by default and says so — work doesn't pile up; a rule can be set
 *   to make one anyway.
 * - After downtime only the latest missed copy is made; the rest are
 *   recorded as missed, never dumped as a backlog.
 * - runRecurringTasks() is idempotent (a rule can never make the same date
 *   twice), so it runs from the 15-minute work-updates job as well as
 *   /api/cron/recurring.
 */

export type WhenOpen = "skip" | "create";
export type ReviewMode = "review" | "none";
export type SkipReason = "holiday" | "day_off" | "still_open" | "missed" | "skipped";

export interface RuleInput {
  projectId: number | null;
  newProjectName: string | null;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  ownerId: number;
  estimatedHours: number | null;
  frequency: Frequency;
  interval: number;
  weekdays: Weekday[];
  monthDay: number | null;
  startDate: string;
  endDate: string | null;
  dueAfterDays: number;
  whenOpen: WhenOpen;
  /** Only an admin's own rule carries it; otherwise the approver sets it. */
  reviewMode: ReviewMode | null;
  subtasks: { title: string; assigneeId: number | null }[];
}

export interface HistoryItem {
  date: string;
  state: "done" | "late" | "open" | "overdue" | "review" | SkipReason;
  taskId: number | null;
  note: string | null;
}

export interface RuleDto {
  id: number;
  projectId: number | null;
  projectName: string | null;
  newProjectName: string | null;
  title: string;
  description: string | null;
  priority: string;
  ownerId: number | null;
  ownerName: string | null;
  estimatedHours: number | null;
  frequency: Frequency;
  interval: number;
  weekdays: Weekday[];
  monthDay: number | null;
  startDate: string;
  endDate: string | null;
  dueAfterDays: number;
  whenOpen: WhenOpen;
  reviewMode: ReviewMode | null;
  approvalStatus: "pending" | "approved" | "rejected";
  decisionNote: string | null;
  decidedByName: string | null;
  isActive: boolean;
  pausedReason: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAt: string;
  schedule: string;
  subtasks: { id: number; title: string; assigneeId: number | null; assigneeName: string | null }[];
  /** The next copy's date, after holidays; null when none is coming. */
  next: string | null;
  /** Set when the next copy moves off its scheduled day. */
  nextNote: string | null;
  /** The schedule's next date, if it's marked to be skipped. */
  skippingNext: string | null;
  history: HistoryItem[];
  openCopies: number;
  onTime: { done: number; onTime: number };
  /** May edit, pause, skip and end it. */
  canManage: boolean;
  /** Is the person looking at it its owner, or on one of its subtasks? */
  mine: boolean;
}

/** India date ("YYYY-MM-DD") of an instant. */
export function istDate(d: Date = new Date()): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

function dateOnly(v: unknown): string | null {
  return v == null ? null : String(v).slice(0, 10);
}

function short(s: string, n = 80): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function scheduleOf(r: DbRow): Schedule {
  const start = dateOnly(r.start_date) ?? dateOnly(r.next_run)!;
  const weekdays = parseWeekdays(r.weekdays);
  return {
    frequency: r.recurrence as Frequency,
    interval: Number(r.interval_n ?? 1) || 1,
    // Rules from before weekdays existed fall on their start's weekday.
    weekdays: weekdays.length ? weekdays : [weekdayOf(start)],
    monthDay: r.month_day == null ? Number(start.slice(8, 10)) : Number(r.month_day),
    startDate: start,
    endDate: dateOnly(r.end_date),
  };
}

function prettyDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

async function admins(): Promise<number[]> {
  const rows = await query<DbRow[]>(`SELECT id FROM users WHERE role = 'admin' AND is_active = 1`);
  return rows.map((r) => Number(r.id));
}

// ── Making copies ──────────────────────────────────────────────────────────

const RULE_SELECT = `
  SELECT rt.*, p.approval_status AS p_approval, p.status AS p_status, p.owner_id AS p_owner,
         u.employee_id AS owner_employee, u.is_active AS owner_active, u.name AS owner_name
    FROM recurring_tasks rt
    JOIN projects p ON p.id = rt.project_id
    LEFT JOIN users u ON u.id = rt.assignee_id`;

async function recordSkip(ruleId: number, date: string, reason: SkipReason, movedTo: string | null = null, by: number | null = null) {
  await query(
    `INSERT IGNORE INTO recurring_skips (recurring_task_id, occurrence_date, reason, moved_to, created_by) VALUES (?, ?, ?, ?, ?)`,
    [ruleId, date, reason, movedTo, by]
  );
}

/** Copy one rule for one date. Returns the new task's id, or null if that date exists. */
async function createCopy(rule: DbRow, on: string, isWorkingDay: (d: string) => boolean): Promise<number | null> {
  // The due date moves off a day off too, so nobody is late over a holiday.
  let due = addDays(on, Number(rule.due_after_days ?? 0));
  for (let i = 0; i < 14 && !isWorkingDay(due); i++) due = addDays(due, 1);
  const requester = rule.created_by ?? rule.p_owner ?? null;
  const approver = rule.decided_by ?? rule.created_by ?? rule.p_owner ?? null;
  let taskId: number;
  try {
    const res = (await query<DbResult>(
      `INSERT INTO tasks
         (project_id, title, description, status, priority, estimated_hours, assignee_id, created_by,
          due_date, start_date, requested_by, request_approved_by, request_approved_at,
          weight, weight_mode, recurring_task_id, occurrence_date, auto_approve)
       VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), 0, 'manual', ?, ?, ?)`,
      [
        rule.project_id,
        rule.title,
        rule.description ?? null,
        rule.priority ?? "medium",
        rule.estimated_hours ?? null,
        rule.owner_active ? rule.assignee_id : null,
        rule.created_by ?? null,
        due,
        on,
        requester,
        approver,
        rule.id,
        on,
        rule.review_mode === "none" ? 1 : 0,
      ]
    )) as unknown as DbResult;
    taskId = res.insertId;
  } catch (e) {
    if ((e as { code?: string }).code === "ER_DUP_ENTRY") return null;
    throw e;
  }

  const subs = await query<DbRow[]>(
    `SELECT rs.title, rs.assignee_id, u.is_active
       FROM recurring_subtasks rs LEFT JOIN users u ON u.id = rs.assignee_id
      WHERE rs.recurring_task_id = ? ORDER BY rs.position, rs.id`,
    [rule.id]
  );
  let pos = 0;
  for (const s of subs) {
    // A step with nobody named (or whose person has left) is the owner's.
    const who = s.assignee_id && s.is_active ? Number(s.assignee_id) : rule.owner_active && rule.assignee_id ? Number(rule.assignee_id) : null;
    await query(
      `INSERT INTO subtasks (task_id, title, assignee_id, position, start_date, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [taskId, s.title, who, pos++, on, due, rule.created_by ?? null]
    );
    if (who && who !== rule.assignee_id) {
      await notify(who, "subtask_assigned", `↻ Your part “${short(String(s.title), 60)}” of “${short(String(rule.title), 60)}” is ready for ${prettyDate(on)}`, `/projects/${rule.project_id}?task=${taskId}`);
    }
  }

  await logActivity({
    userId: rule.created_by ?? null,
    action: "task.created",
    entityType: "task",
    entityId: taskId,
    metadata: { title: rule.title, recurring: rule.id, date: on, automatic: true },
  });
  if (rule.owner_active && rule.assignee_id) {
    await notify(rule.assignee_id, "task_assigned", `↻ “${short(String(rule.title))}” for ${prettyDate(on)} is ready`, `/projects/${rule.project_id}?task=${taskId}`);
  }
  return taskId;
}

export interface RunResult {
  created: number;
  skipped: number;
  paused: number;
  calendarUnavailable: boolean;
}

/**
 * Make every copy that is due by today (India time). Safe to run as often
 * as you like.
 */
export async function runRecurringTasks(opts: { now?: Date; ruleIds?: number[]; calendar?: WorkCalendar } = {}): Promise<RunResult> {
  const today = istDate(opts.now ?? new Date());
  const result: RunResult = { created: 0, skipped: 0, paused: 0, calendarUnavailable: false };
  const only = opts.ruleIds?.length ? ` AND rt.id IN (${opts.ruleIds.map(() => "?").join(",")})` : "";
  const rules = await query<DbRow[]>(
    `${RULE_SELECT}
      WHERE rt.is_active = 1 AND rt.approval_status = 'approved'
        AND (rt.last_run IS NULL OR rt.last_run < ?)
        -- read-only projects (pending/rejected requests, completed) get no new work
        AND p.approval_status = 'approved' AND p.status <> 'completed'${only}`,
    [today, ...(opts.ruleIds ?? [])]
  );
  if (!rules.length) return result;

  const earliest = rules.reduce((min, r) => {
    const from = r.last_run ? addDays(dateOnly(r.last_run)!, 1) : scheduleOf(r).startDate;
    return from < min ? from : min;
  }, today);
  const calendar =
    opts.calendar ??
    (await loadWorkCalendar(
      rules.map((r) => Number(r.owner_employee)).filter(Boolean),
      addDays(earliest < addDays(today, -60) ? addDays(today, -60) : earliest, -1),
      addDays(today, 31)
    ));
  result.calendarUnavailable = calendar.unavailable;

  for (const rule of rules) {
    // The owner has left: stop, and say why, rather than make copies nobody owns.
    if (rule.assignee_id && !rule.owner_active) {
      await query(`UPDATE recurring_tasks SET is_active = 0, paused_reason = ? WHERE id = ?`, [`${short(String(rule.owner_name ?? "Its owner"), 60)} has left`, rule.id]);
      for (const to of new Set([rule.created_by, rule.p_owner].filter(Boolean) as number[])) {
        await notify(to, "recurring_paused", `↻ “${short(String(rule.title))}” is paused: ${rule.owner_name ?? "its owner"} has left. Give it a new owner to restart it.`, `/recurring?rule=${rule.id}`);
      }
      result.paused++;
      continue;
    }

    const s = scheduleOf(rule);
    const works = forPerson(calendar, rule.owner_employee ? Number(rule.owner_employee) : null);
    // Look back at most 60 days: older dates are history, not work to make.
    let from = rule.last_run ? addDays(dateOnly(rule.last_run)!, 1) : s.startDate;
    if (from < addDays(today, -60)) from = addDays(today, -60);
    const handSkipped = new Set(
      (
        await query<DbRow[]>(`SELECT occurrence_date FROM recurring_skips WHERE recurring_task_id = ? AND reason = 'skipped'`, [rule.id])
      ).map((r) => dateOnly(r.occurrence_date)!)
    );

    const due: { date: string; on: string }[] = [];
    let handledTo = today;
    for (let d = from; d <= today; d = addDays(d, 1)) {
      if (!fallsOn(s, d)) continue;
      if (handSkipped.has(d)) continue;
      const p = place(s, d, works);
      if (!p.on) {
        const reason = calendar.holidayName(rule.owner_employee ? Number(rule.owner_employee) : null, d) ? "holiday" : "day_off";
        // A daily rule not falling on a weekly day off is just the schedule, not news.
        if (!(s.frequency === "daily" && reason === "day_off")) {
          await recordSkip(rule.id, d, reason);
          result.skipped++;
        }
        continue;
      }
      if (p.on > today) {
        // Moved past today: come back to it then.
        handledTo = addDays(d, -1);
        break;
      }
      if (p.on !== d) {
        await recordSkip(rule.id, d, calendar.holidayName(rule.owner_employee ? Number(rule.owner_employee) : null, d) ? "holiday" : "day_off", p.on);
      }
      due.push({ date: d, on: p.on });
    }

    if (due.length) {
      // After downtime, only the latest copy is made.
      for (const m of due.slice(0, -1)) {
        await recordSkip(rule.id, m.date, "missed");
        result.skipped++;
      }
      const last = due[due.length - 1];
      const [exists] = await query<DbRow[]>(
        `SELECT id FROM tasks WHERE recurring_task_id = ? AND occurrence_date = ? LIMIT 1`,
        [rule.id, last.on]
      );
      if (!exists) {
        const [open] = await query<DbRow[]>(
          `SELECT id, occurrence_date FROM tasks
            WHERE recurring_task_id = ? AND status IN ('todo','in_progress') AND signed_off_at IS NULL
            ORDER BY occurrence_date DESC LIMIT 1`,
          [rule.id]
        );
        if (open && rule.when_open !== "create") {
          await recordSkip(rule.id, last.date, "still_open");
          result.skipped++;
          for (const to of new Set([rule.assignee_id, rule.created_by].filter(Boolean) as number[])) {
            await notify(
              to,
              "recurring_skipped",
              `↻ No new copy of “${short(String(rule.title))}” for ${prettyDate(last.on)}: the one for ${prettyDate(dateOnly(open.occurrence_date) ?? last.on)} is still open`,
              `/projects/${rule.project_id}?task=${open.id}`
            );
          }
        } else if (await createCopy(rule, last.on, works)) {
          result.created++;
        }
      }
    }

    const next = upcoming(s, addDays(handledTo, 1), 1)[0] ?? null;
    if (!next && s.endDate && s.endDate <= today) {
      await query(`UPDATE recurring_tasks SET last_run = ?, is_active = 0, paused_reason = 'Ended' WHERE id = ?`, [handledTo, rule.id]);
    } else {
      await query(`UPDATE recurring_tasks SET last_run = ?, next_run = COALESCE(?, next_run) WHERE id = ?`, [handledTo, next, rule.id]);
    }
  }
  return result;
}

// ── Finishing copies that need no review ───────────────────────────────────

/**
 * A copy of a no-review rule whose work is complete: Done and signed off at
 * once, on the authority of the admin who approved the rule.
 */
export async function finishRoutineCopy(taskId: number, actor: User): Promise<boolean> {
  const [t] = await query<DbRow[]>(
    `SELECT t.id, t.title, t.project_id, t.status, rt.decided_by
       FROM tasks t LEFT JOIN recurring_tasks rt ON rt.id = t.recurring_task_id
      WHERE t.id = ? AND t.auto_approve = 1 AND t.signed_off_at IS NULL LIMIT 1`,
    [taskId]
  );
  if (!t || t.status === "done") return false;
  const res = (await query<DbResult>(
    `UPDATE tasks SET status = 'done', approval_status = 'approved', approved_by = ?, approved_at = UTC_TIMESTAMP(),
            completed_at = UTC_TIMESTAMP(), signed_off_by = ?, signed_off_at = UTC_TIMESTAMP(),
            signoff_note = 'Routine recurring task — no review needed'
      WHERE id = ? AND status = ? AND signed_off_at IS NULL`,
    [actor.id, t.decided_by ?? actor.id, taskId, t.status]
  )) as unknown as DbResult;
  if (!res.affectedRows) return false;
  await logActivity({
    userId: actor.id,
    action: "task.status_changed",
    entityType: "task",
    entityId: taskId,
    metadata: { from: t.status, to: "done", automatic: true, reason: "recurring_no_review" },
  });
  return true;
}

// ── Reading rules ──────────────────────────────────────────────────────────

async function managedProjectIds(user: User): Promise<Set<number>> {
  if (user.role === "admin") return new Set();
  const rows = await query<DbRow[]>(
    `SELECT id FROM projects WHERE owner_id = ?
     UNION SELECT project_id FROM project_members WHERE user_id = ? AND role_in_project = 'lead'`,
    [user.id, user.id]
  );
  return new Set(rows.map((r) => Number(r.id)));
}

function historyOf(copies: DbRow[], skips: DbRow[], today: string): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const c of copies) {
    const date = dateOnly(c.occurrence_date)!;
    const dueDate = dateOnly(c.due_date) ?? date;
    let state: HistoryItem["state"];
    if (c.status === "done") state = c.completed_at && istDate(new Date(String(c.completed_at).replace(" ", "T") + "Z")) > dueDate ? "late" : "done";
    else if (c.status === "review") state = "review";
    else state = dueDate < today ? "overdue" : "open";
    items.push({ date, state, taskId: Number(c.id), note: null });
  }
  for (const s of skips) {
    if (s.moved_to) continue; // made on another day; the copy is listed
    items.push({ date: dateOnly(s.occurrence_date)!, state: s.reason as SkipReason, taskId: null, note: null });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

/** The rules a person can see, newest activity first, ready for the page. */
export async function listRules(user: User, opts: { projectId?: number; ruleId?: number; now?: Date } = {}): Promise<RuleDto[]> {
  const today = istDate(opts.now ?? new Date());
  const isAdmin = user.role === "admin";
  const where: string[] = [];
  const params: unknown[] = [];
  if (!isAdmin) {
    where.push(`(rt.created_by = ? OR rt.assignee_id = ?
                 OR EXISTS (SELECT 1 FROM recurring_subtasks x WHERE x.recurring_task_id = rt.id AND x.assignee_id = ?)
                 OR rt.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
                 OR rt.project_id IN (SELECT id FROM projects WHERE owner_id = ?))`);
    params.push(user.id, user.id, user.id, user.id, user.id);
  }
  if (opts.projectId) {
    where.push(`rt.project_id = ?`);
    params.push(opts.projectId);
  }
  if (opts.ruleId) {
    where.push(`rt.id = ?`);
    params.push(opts.ruleId);
  }
  const rows = await query<DbRow[]>(
    `SELECT rt.*, p.name AS project_name, u.name AS owner_name, u.employee_id AS owner_employee,
            c.name AS created_by_name, d.name AS decided_by_name
       FROM recurring_tasks rt
       LEFT JOIN projects p ON p.id = rt.project_id
       LEFT JOIN users u ON u.id = rt.assignee_id
       LEFT JOIN users c ON c.id = rt.created_by
       LEFT JOIN users d ON d.id = rt.decided_by
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY (rt.approval_status = 'pending') DESC, rt.is_active DESC, rt.title`,
    params
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.id));
  const inIds = ids.map(() => "?").join(",");
  const [subs, copies, skips, calendar, managed] = await Promise.all([
    query<DbRow[]>(
      `SELECT rs.id, rs.recurring_task_id, rs.title, rs.assignee_id, u.name AS assignee_name
         FROM recurring_subtasks rs LEFT JOIN users u ON u.id = rs.assignee_id
        WHERE rs.recurring_task_id IN (${inIds}) ORDER BY rs.position, rs.id`,
      ids
    ),
    query<DbRow[]>(
      `SELECT id, recurring_task_id, occurrence_date, due_date, status, completed_at
         FROM tasks WHERE recurring_task_id IN (${inIds}) AND occurrence_date >= ?
        ORDER BY occurrence_date DESC`,
      [...ids, addDays(today, -120)]
    ),
    query<DbRow[]>(
      `SELECT recurring_task_id, occurrence_date, reason, moved_to FROM recurring_skips
        WHERE recurring_task_id IN (${inIds}) AND occurrence_date >= ?`,
      [...ids, addDays(today, -120)]
    ),
    loadWorkCalendar(rows.map((r) => Number(r.owner_employee)).filter(Boolean), today, addDays(today, 62)),
    managedProjectIds(user),
  ]);

  return rows.map((r) => {
    const id = Number(r.id);
    const s = scheduleOf(r);
    const emp = r.owner_employee ? Number(r.owner_employee) : null;
    const works = forPerson(calendar, emp);
    const mySkips = skips.filter((k) => Number(k.recurring_task_id) === id);
    const skipped = new Set(mySkips.filter((k) => k.reason === "skipped").map((k) => dateOnly(k.occurrence_date)!));
    const copiesOf = copies.filter((c) => Number(c.recurring_task_id) === id);
    const madeToday = copiesOf.some((c) => dateOnly(c.occurrence_date)! >= today);
    const lastRun = dateOnly(r.last_run);
    // The next date the schedule names that hasn't been dealt with yet.
    const from = lastRun && lastRun >= today ? addDays(today, 1) : madeToday ? addDays(today, 1) : today;
    const nominal = upcoming(s, from, 4).filter((d) => fallsOn(s, d));
    const skippingNext = nominal.find((d) => skipped.has(d)) ?? null;
    const firstLive = nominal.find((d) => !skipped.has(d)) ?? null;
    const placed = firstLive ? place(s, firstLive, works) : null;
    const active = Boolean(r.is_active) && r.approval_status === "approved";
    const holiday = firstLive && placed && placed.on !== firstLive ? calendar.holidayName(emp, firstLive) : null;
    const history = historyOf(copiesOf, mySkips, today).slice(0, 10);
    const done = copiesOf.filter((c) => c.status === "done").slice(0, 20);
    const subtasks = subs
      .filter((x) => Number(x.recurring_task_id) === id)
      .map((x) => ({ id: Number(x.id), title: String(x.title), assigneeId: x.assignee_id == null ? null : Number(x.assignee_id), assigneeName: (x.assignee_name as string) ?? null }));
    return {
      id,
      projectId: r.project_id == null ? null : Number(r.project_id),
      projectName: (r.project_name as string) ?? null,
      newProjectName: (r.new_project_name as string) ?? null,
      title: String(r.title),
      description: (r.description as string) ?? null,
      priority: String(r.priority),
      ownerId: r.assignee_id == null ? null : Number(r.assignee_id),
      ownerName: (r.owner_name as string) ?? null,
      estimatedHours: r.estimated_hours == null ? null : Number(r.estimated_hours),
      frequency: s.frequency,
      interval: s.interval,
      weekdays: s.weekdays,
      monthDay: s.monthDay,
      startDate: s.startDate,
      endDate: s.endDate,
      dueAfterDays: Number(r.due_after_days ?? 0),
      whenOpen: (r.when_open as WhenOpen) ?? "skip",
      reviewMode: (r.review_mode as ReviewMode) ?? null,
      approvalStatus: r.approval_status,
      decisionNote: (r.decision_note as string) ?? null,
      decidedByName: (r.decided_by_name as string) ?? null,
      isActive: Boolean(r.is_active),
      pausedReason: (r.paused_reason as string) ?? null,
      createdBy: r.created_by == null ? null : Number(r.created_by),
      createdByName: (r.created_by_name as string) ?? null,
      createdAt: String(r.created_at),
      schedule: describeSchedule(s),
      subtasks,
      next: active ? placed?.on ?? null : null,
      nextNote:
        active && placed && firstLive && placed.on !== firstLive
          ? `moved from ${prettyDate(firstLive)}${holiday ? ` — ${holiday}` : " (day off)"}`
          : active && placed && !placed.on
            ? "skipped — holiday or day off"
            : null,
      skippingNext: active ? skippingNext : null,
      history,
      openCopies: copiesOf.filter((c) => c.status === "todo" || c.status === "in_progress").length,
      onTime: { done: done.length, onTime: historyOf(done, [], today).filter((h) => h.state === "done").length },
      canManage: isAdmin || Number(r.created_by) === user.id || (r.project_id != null && managed.has(Number(r.project_id))),
      mine: Number(r.assignee_id) === user.id || subtasks.some((x) => x.assigneeId === user.id),
    } satisfies RuleDto;
  });
}

// ── Writing rules ──────────────────────────────────────────────────────────

/** Can this person see the project and add work to it? */
async function assertCanUseProject(user: User, projectId: number): Promise<DbRow> {
  const [p] = await query<DbRow[]>(`SELECT id, name, owner_id, approval_status, status FROM projects WHERE id = ? LIMIT 1`, [projectId]);
  if (!p) throw notFound("Project not found");
  if (p.approval_status !== "approved" || p.status === "completed") throw badRequest("That project isn't open for new work");
  if (user.role !== "admin" && !(await getProjectRole(user.id, projectId))) throw forbidden("You're not on that project");
  return p;
}

async function assertPeople(projectId: number | null, ids: number[]): Promise<void> {
  const want = [...new Set(ids.filter(Boolean))];
  if (!want.length) return;
  const rows = await query<DbRow[]>(
    `SELECT id FROM users WHERE is_active = 1 AND id IN (${want.map(() => "?").join(",")})`,
    want
  );
  if (rows.length !== want.length) throw badRequest("Someone you chose isn't an active member of staff");
  if (projectId == null) return;
  const members = await query<DbRow[]>(
    `SELECT user_id AS id FROM project_members WHERE project_id = ? AND user_id IN (${want.map(() => "?").join(",")})
     UNION SELECT owner_id FROM projects WHERE id = ? AND owner_id IN (${want.map(() => "?").join(",")})`,
    [projectId, ...want, projectId, ...want]
  );
  if (new Set(members.map((m) => Number(m.id))).size !== want.length) {
    throw badRequest("The owner and everyone on a subtask must be members of the project");
  }
}

function validateSchedule(i: RuleInput) {
  if (i.frequency === "weekly" && !i.weekdays.length) throw badRequest("Choose at least one day of the week");
  if (i.frequency === "monthly" && (i.monthDay == null || i.monthDay < 0 || i.monthDay > 31)) throw badRequest("Choose a day of the month");
  if (i.endDate && i.endDate < i.startDate) throw badRequest("The end date is before the start date");
}

async function writeSubtasks(ruleId: number, subtasks: RuleInput["subtasks"]) {
  await query(`DELETE FROM recurring_subtasks WHERE recurring_task_id = ?`, [ruleId]);
  let pos = 0;
  for (const s of subtasks) {
    await query(`INSERT INTO recurring_subtasks (recurring_task_id, title, assignee_id, position) VALUES (?, ?, ?, ?)`, [ruleId, s.title, s.assigneeId, pos++]);
  }
}

function scheduleFromInput(i: RuleInput): Schedule {
  return { frequency: i.frequency, interval: i.interval, weekdays: i.weekdays, monthDay: i.monthDay, startDate: i.startDate, endDate: i.endDate };
}

/** A project of its own for an approved rule, with its people on it. */
async function createProjectFor(ruleId: number, name: string, ownerId: number, approverId: number, people: number[]): Promise<number> {
  const [owner] = await query<DbRow[]>(`SELECT department FROM users WHERE id = ?`, [ownerId]);
  const res = (await query<DbResult>(
    `INSERT INTO projects (name, description, department, status, approval_status, owner_id, requested_by, requested_at, decided_by, decided_at, start_date)
     VALUES (?, ?, ?, 'active', 'approved', ?, ?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP(), CURRENT_DATE())`,
    [name, "Recurring work", owner?.department ?? null, ownerId, ownerId, approverId]
  )) as unknown as DbResult;
  const projectId = res.insertId;
  await query(`INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'lead') ON DUPLICATE KEY UPDATE role_in_project = 'lead'`, [projectId, ownerId]);
  for (const id of new Set(people.filter((p) => p && p !== ownerId))) {
    await query(`INSERT IGNORE INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'member')`, [projectId, id]);
  }
  await query(`UPDATE recurring_tasks SET project_id = ?, new_project_name = NULL WHERE id = ?`, [projectId, ruleId]);
  await logActivity({ userId: approverId, action: "project.created", entityType: "project", entityId: projectId, metadata: { name, recurring: ruleId } });
  return projectId;
}

/** Propose (or, for an admin, set up) a recurring rule. */
export async function createRule(user: User, i: RuleInput, now = new Date()): Promise<number> {
  const isAdmin = user.role === "admin";
  validateSchedule(i);
  if (!i.projectId && !i.newProjectName) throw badRequest("Choose a project, or name a new one");
  if (i.projectId) await assertCanUseProject(user, i.projectId);
  await assertPeople(i.projectId, [i.ownerId, ...i.subtasks.map((s) => s.assigneeId ?? 0)]);
  if (isAdmin && !i.reviewMode) throw badRequest("Say whether each copy needs review");

  const today = istDate(now);
  const start = i.startDate < today ? today : i.startDate;
  const next = upcoming(scheduleFromInput({ ...i, startDate: start }), start, 1)[0] ?? start;
  const res = (await query<DbResult>(
    `INSERT INTO recurring_tasks
       (project_id, new_project_name, title, description, priority, assignee_id, estimated_hours,
        recurrence, interval_n, weekdays, month_day, start_date, end_date, due_after_days, when_open,
        review_mode, approval_status, decided_by, decided_at, next_run, last_run, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${isAdmin ? "UTC_TIMESTAMP()" : "NULL"}, ?, ?, ?)`,
    [
      i.projectId,
      i.projectId ? null : i.newProjectName,
      i.title,
      i.description,
      i.priority,
      i.ownerId,
      i.estimatedHours,
      i.frequency,
      i.interval,
      i.frequency === "weekly" ? i.weekdays.join(",") : null,
      i.frequency === "monthly" ? i.monthDay : null,
      start,
      i.endDate,
      i.dueAfterDays,
      i.whenOpen,
      isAdmin ? i.reviewMode : null,
      isAdmin ? "approved" : "pending",
      isAdmin ? user.id : null,
      next,
      addDays(start, -1),
      user.id,
    ]
  )) as unknown as DbResult;
  const ruleId = res.insertId;
  await writeSubtasks(ruleId, i.subtasks);
  await logActivity({ userId: user.id, action: isAdmin ? "recurring.created" : "recurring.proposed", entityType: "project", entityId: i.projectId, metadata: { ruleId, title: i.title } });

  if (isAdmin) {
    if (!i.projectId && i.newProjectName) {
      await createProjectFor(ruleId, i.newProjectName, user.id, user.id, [i.ownerId, ...i.subtasks.map((s) => s.assigneeId ?? 0)]);
    }
    await runRecurringTasks({ now, ruleIds: [ruleId] });
  } else {
    for (const a of await admins()) {
      await notify(a, "recurring_request", `↻ ${short(user.name, 40)} proposed a recurring task: “${short(i.title, 80)}” — approve it to start it`, `/recurring?rule=${ruleId}`);
    }
  }
  return ruleId;
}

async function loadRule(id: number): Promise<DbRow> {
  const [r] = await query<DbRow[]>(`SELECT * FROM recurring_tasks WHERE id = ? LIMIT 1`, [id]);
  if (!r) throw notFound("Recurring task not found");
  return r;
}

async function assertManage(user: User, r: DbRow) {
  if (user.role === "admin" || Number(r.created_by) === user.id) return;
  if (r.project_id != null) {
    const role = await getProjectRole(user.id, Number(r.project_id));
    const [p] = await query<DbRow[]>(`SELECT owner_id FROM projects WHERE id = ?`, [r.project_id]);
    if (role === "lead" || Number(p?.owner_id) === user.id) return;
  }
  throw forbidden("Only its project's leads, whoever set it up, or an admin can change this");
}

/** Edit a rule. Copies already made are left as they are. */
export async function updateRule(user: User, id: number, i: RuleInput, now = new Date()): Promise<void> {
  const r = await loadRule(id);
  await assertManage(user, r);
  validateSchedule(i);
  const projectId = r.project_id == null ? i.projectId : Number(r.project_id);
  if (projectId && projectId !== Number(r.project_id)) await assertCanUseProject(user, projectId);
  await assertPeople(projectId, [i.ownerId, ...i.subtasks.map((s) => s.assigneeId ?? 0)]);
  const today = istDate(now);
  const lastRun = dateOnly(r.last_run);
  const handled = lastRun && lastRun >= today ? today : addDays(today, -1);
  const next = upcoming(scheduleFromInput(i), addDays(handled, 1), 1)[0] ?? dateOnly(r.next_run);
  // An admin may change the review mode; it then applies to new copies.
  const reviewMode = user.role === "admin" && r.approval_status === "approved" && i.reviewMode ? i.reviewMode : r.review_mode;
  await query(
    `UPDATE recurring_tasks SET project_id = ?, new_project_name = ?, title = ?, description = ?, priority = ?, assignee_id = ?,
            estimated_hours = ?, recurrence = ?, interval_n = ?, weekdays = ?, month_day = ?, start_date = ?, end_date = ?,
            due_after_days = ?, when_open = ?, review_mode = ?, next_run = ?,
            -- a new owner restarts a rule paused because the old one left
            is_active = IF(paused_reason LIKE '% has left', 1, is_active),
            paused_reason = IF(paused_reason LIKE '% has left', NULL, paused_reason),
            last_run = IF(paused_reason LIKE '% has left', ?, last_run)
      WHERE id = ?`,
    [
      projectId,
      projectId ? null : i.newProjectName,
      i.title,
      i.description,
      i.priority,
      i.ownerId,
      i.estimatedHours,
      i.frequency,
      i.interval,
      i.frequency === "weekly" ? i.weekdays.join(",") : null,
      i.frequency === "monthly" ? i.monthDay : null,
      i.startDate,
      i.endDate,
      i.dueAfterDays,
      i.whenOpen,
      reviewMode,
      next,
      handled,
      id,
    ]
  );
  await writeSubtasks(id, i.subtasks);
  await logActivity({ userId: user.id, action: "recurring.updated", entityType: "project", entityId: projectId, metadata: { ruleId: id, title: i.title } });
  if (r.approval_status === "approved") await runRecurringTasks({ now, ruleIds: [id] });
}

export type RuleAction =
  | { action: "pause" }
  | { action: "resume" }
  | { action: "skip_next" }
  | { action: "unskip" }
  | { action: "end" }
  | { action: "approve"; reviewMode: ReviewMode; note?: string | null }
  | { action: "reject"; note: string };

export async function actOnRule(user: User, id: number, a: RuleAction, now = new Date()): Promise<void> {
  const r = await loadRule(id);
  const today = istDate(now);
  const link = `/recurring?rule=${id}`;

  if (a.action === "approve" || a.action === "reject") {
    if (user.role !== "admin") throw forbidden("Only an admin can approve recurring tasks");
    if (r.approval_status !== "pending") throw conflict("This has already been decided");
    if (a.action === "reject") {
      if (!a.note?.trim()) throw badRequest("Say why, so they can fix it");
      await query(`UPDATE recurring_tasks SET approval_status = 'rejected', decided_by = ?, decided_at = UTC_TIMESTAMP(), decision_note = ? WHERE id = ?`, [user.id, a.note.trim(), id]);
      if (r.created_by) await notify(Number(r.created_by), "recurring_rejected", `↻ “${short(String(r.title))}” wasn't approved: ${short(a.note.trim(), 120)}`, link);
      await logActivity({ userId: user.id, action: "recurring.rejected", entityType: "project", entityId: r.project_id, metadata: { ruleId: id } });
      return;
    }
    const start = dateOnly(r.start_date)! < today ? today : dateOnly(r.start_date)!;
    await query(
      `UPDATE recurring_tasks SET approval_status = 'approved', review_mode = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(),
              decision_note = ?, start_date = ?, last_run = ? WHERE id = ?`,
      [a.reviewMode, user.id, a.note?.trim() || null, start, addDays(start, -1), id]
    );
    if (r.project_id == null && r.new_project_name) {
      const people = (await query<DbRow[]>(`SELECT assignee_id FROM recurring_subtasks WHERE recurring_task_id = ?`, [id])).map((x) => Number(x.assignee_id));
      await createProjectFor(id, String(r.new_project_name), Number(r.created_by ?? user.id), user.id, [Number(r.assignee_id), ...people]);
    }
    if (r.created_by && Number(r.created_by) !== user.id) {
      await notify(
        Number(r.created_by),
        "recurring_approved",
        `↻ “${short(String(r.title))}” was approved${a.reviewMode === "none" ? " — copies need no review" : ""}. The first copy arrives on its first date.`,
        link
      );
    }
    await logActivity({ userId: user.id, action: "recurring.approved", entityType: "project", entityId: r.project_id, metadata: { ruleId: id, reviewMode: a.reviewMode } });
    await runRecurringTasks({ now, ruleIds: [id] });
    return;
  }

  await assertManage(user, r);
  if (r.approval_status !== "approved") {
    if (a.action !== "end") throw conflict("This is still waiting for an admin");
  }
  switch (a.action) {
    case "pause":
      await query(`UPDATE recurring_tasks SET is_active = 0, paused_reason = ? WHERE id = ?`, [`Paused by ${short(user.name, 60)}`, id]);
      break;
    case "resume":
      // Dates while it was paused are not made up afterwards.
      await query(`UPDATE recurring_tasks SET is_active = 1, paused_reason = NULL, last_run = GREATEST(COALESCE(last_run, ?), ?) WHERE id = ?`, [addDays(today, -1), addDays(today, -1), id]);
      await runRecurringTasks({ now, ruleIds: [id] });
      break;
    case "skip_next": {
      const s = scheduleOf(r);
      const lastRun = dateOnly(r.last_run);
      const from = lastRun && lastRun >= today ? addDays(today, 1) : today;
      const skipped = new Set(
        (await query<DbRow[]>(`SELECT occurrence_date FROM recurring_skips WHERE recurring_task_id = ? AND reason = 'skipped'`, [id])).map((x) => dateOnly(x.occurrence_date)!)
      );
      const [made] = await query<DbRow[]>(`SELECT 1 FROM tasks WHERE recurring_task_id = ? AND occurrence_date >= ? LIMIT 1`, [id, today]);
      const next = upcoming(s, made ? addDays(today, 1) : from, 6).find((d) => fallsOn(s, d) && !skipped.has(d));
      if (!next) throw conflict("There's no upcoming copy to skip");
      await recordSkip(id, next, "skipped", null, user.id);
      break;
    }
    case "unskip":
      await query(`DELETE FROM recurring_skips WHERE recurring_task_id = ? AND reason = 'skipped' AND occurrence_date >= ?`, [id, today]);
      break;
    case "end":
      if (r.approval_status !== "approved") {
        await query(`DELETE FROM recurring_tasks WHERE id = ?`, [id]);
      } else {
        await query(`UPDATE recurring_tasks SET is_active = 0, paused_reason = 'Ended', end_date = ? WHERE id = ?`, [today, id]);
      }
      break;
  }
  await logActivity({ userId: user.id, action: `recurring.${a.action}`, entityType: "project", entityId: r.project_id, metadata: { ruleId: id } });
}

/** Delete a rule for good. Its copies stay, unlinked. Admin only. */
export async function deleteRule(user: User, id: number): Promise<void> {
  if (user.role !== "admin") throw forbidden("Only an admin can delete a recurring task; others can end it");
  const r = await loadRule(id);
  await query(`UPDATE tasks SET recurring_task_id = NULL WHERE recurring_task_id = ?`, [id]);
  await query(`DELETE FROM recurring_tasks WHERE id = ?`, [id]);
  await logActivity({ userId: user.id, action: "recurring.deleted", entityType: "project", entityId: r.project_id, metadata: { ruleId: id, title: r.title } });
}

/** Projects this person can put recurring work in, with their people. */
export async function ruleOptions(user: User) {
  const projects = await query<DbRow[]>(
    user.role === "admin"
      ? `SELECT id, name FROM projects WHERE approval_status = 'approved' AND status <> 'completed' ORDER BY name`
      : `SELECT DISTINCT p.id, p.name FROM projects p
           LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?
          WHERE p.approval_status = 'approved' AND p.status <> 'completed' AND (pm.user_id IS NOT NULL OR p.owner_id = ?)
          ORDER BY p.name`,
    user.role === "admin" ? [] : [user.id, user.id]
  );
  const ids = projects.map((p) => Number(p.id));
  const members = ids.length
    ? await query<DbRow[]>(
        `SELECT pm.project_id, u.id, u.name FROM project_members pm JOIN users u ON u.id = pm.user_id
          WHERE u.is_active = 1 AND pm.project_id IN (${ids.map(() => "?").join(",")})
         UNION
         SELECT p.id, u.id, u.name FROM projects p JOIN users u ON u.id = p.owner_id
          WHERE u.is_active = 1 AND p.id IN (${ids.map(() => "?").join(",")})
         ORDER BY name`,
        [...ids, ...ids]
      )
    : [];
  const people = await query<DbRow[]>(`SELECT id, name FROM users WHERE is_active = 1 ORDER BY name`);
  return {
    projects: projects.map((p) => {
      const seen = new Set<number>();
      return {
        id: Number(p.id),
        name: String(p.name),
        members: members
          .filter((m) => Number(m.project_id) === Number(p.id))
          .filter((m) => (seen.has(Number(m.id)) ? false : (seen.add(Number(m.id)), true)))
          .map((m) => ({ id: Number(m.id), name: String(m.name) })),
      };
    }),
    people: people.map((p) => ({ id: Number(p.id), name: String(p.name) })),
  };
}

/** For My Work: the next copies coming to this person. */
export async function upcomingForMe(user: User, now = new Date()) {
  const rules = (await listRules(user, { now })).filter((r) => r.mine && r.isActive && r.approvalStatus === "approved" && r.next);
  return rules
    .map((r) => ({ id: r.id, title: r.title, projectName: r.projectName, next: r.next!, schedule: r.schedule }))
    .sort((a, b) => a.next.localeCompare(b.next))
    .slice(0, 6);
}

/** Pending proposals, for an admin's Approvals list. */
export async function pendingRules(): Promise<DbRow[]> {
  return query<DbRow[]>(
    `SELECT rt.id, rt.title, rt.project_id, COALESCE(p.name, CONCAT('New project: ', rt.new_project_name)) AS project_name,
            u.name AS who, rt.created_at AS at
       FROM recurring_tasks rt LEFT JOIN projects p ON p.id = rt.project_id LEFT JOIN users u ON u.id = rt.created_by
      WHERE rt.approval_status = 'pending' ORDER BY rt.created_at`
  );
}
