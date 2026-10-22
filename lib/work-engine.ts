/**
 * lib/work-engine.ts — the rules of the Project › Task › Subtask redesign.
 *
 * Pure functions only (no database), so the server, the pages and the tests
 * all use the same arithmetic. The rules (docs/REDESIGN_PLAN.md §3):
 *
 * - Weights: every child (a task in a project, a subtask in a task) has a
 *   share of its parent. "auto" items split whatever the "manual" ones leave,
 *   evenly; cancelled subtasks drop out and their share is spread again.
 * - Progress counts approved work only. A subtask counts once its task owner
 *   approves it (status 'done'), and that counts all the way up: a task's
 *   approved share flows into its project by the task's weight. A task with
 *   no subtasks counts once it is Done (approved by a project manager). Work
 *   waiting for review is reported separately as `pending` and never counts.
 * - Reviews: a subtask is reviewed by its task's owner (the task assignee);
 *   a task by the project's managers. Someone finishing work they would
 *   review themselves is approved straight away.
 */

export type WeightMode = "auto" | "manual";

/** Anything that takes a share of its parent. */
export interface Weighted {
  id: number;
  weight: number | string; // DECIMAL arrives as a string from mysql2
  weight_mode: WeightMode;
  /** Cancelled items take no share. */
  cancelled?: boolean;
}

export type SubtaskStatus = "todo" | "in_progress" | "review" | "done" | "cancelled";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

/** `approved` counts toward progress; `pending` is finished, awaiting review. */
export interface Progress {
  approved: number; // 0–100
  pending: number; // 0–100
}

const ZERO: Progress = { approved: 0, pending: 0 };

// ── Weights ────────────────────────────────────────────────────────────────

/**
 * Each sibling's effective share, in %. Manual items keep their value; auto
 * items share what is left equally; cancelled items get 0. The shares need
 * not add up to exactly 100 (rounding, an over-full manual set) — roll-ups
 * divide by the total, so a bad total can never show 101%.
 */
export function effectiveWeights(siblings: Weighted[]): Map<number, number> {
  const live = siblings.filter((s) => !s.cancelled);
  const manualSum = live
    .filter((s) => s.weight_mode === "manual")
    .reduce((sum, s) => sum + Number(s.weight), 0);
  const autoCount = live.filter((s) => s.weight_mode === "auto").length;
  const autoShare = autoCount ? Math.max(0, 100 - manualSum) / autoCount : 0;
  const out = new Map<number, number>();
  for (const s of siblings) {
    if (s.cancelled) out.set(s.id, 0);
    else out.set(s.id, s.weight_mode === "manual" ? Number(s.weight) : autoShare);
  }
  return out;
}

/**
 * Before adding a sibling: if every live sibling has a fixed weight, scale
 * them down so the newcomer gets an even share instead of 0%. Returns the
 * new weights to store (empty when nothing needs to change).
 */
export function makeRoom(siblings: Weighted[]): Map<number, number> {
  const live = siblings.filter((s) => !s.cancelled);
  const out = new Map<number, number>();
  if (live.length === 0 || !live.every((s) => s.weight_mode === "manual")) return out;
  const factor = live.length / (live.length + 1);
  for (const s of live) out.set(s.id, round1(Number(s.weight) * factor));
  return out;
}

export interface WeightDraft {
  id: number;
  weight: number;
  locked: boolean;
}

/**
 * The weight editor's rule: set one item and rebalance the others so the
 * total stays exactly 100. Unlocked items absorb the change in proportion to
 * their size; if every other item is locked, they all absorb it. The edited
 * item becomes locked.
 */
export function rebalance(draft: WeightDraft[], id: number, value: number): WeightDraft[] {
  const others = draft.filter((d) => d.id !== id);
  let pool = others.filter((d) => !d.locked);
  if (pool.length === 0) pool = others;
  const fixed = others.filter((d) => !pool.includes(d)).reduce((s, d) => s + d.weight, 0);
  const w = round1(Math.max(0, Math.min(100 - fixed, Number.isFinite(value) ? value : 0)));
  const remaining = 100 - fixed - w;
  const poolSum = pool.reduce((s, d) => s + d.weight, 0);
  const next = new Map<number, number>();
  for (const d of pool) {
    next.set(d.id, round1(poolSum > 0 ? (d.weight / poolSum) * remaining : remaining / pool.length));
  }
  // Give any rounding drift to the largest pool item so the total is 100.
  if (pool.length) {
    const total = w + fixed + [...next.values()].reduce((s, x) => s + x, 0);
    const biggest = pool.reduce((a, b) => ((next.get(a.id) ?? 0) >= (next.get(b.id) ?? 0) ? a : b));
    next.set(biggest.id, Math.max(0, round1((next.get(biggest.id) ?? 0) + (100 - total))));
  }
  return draft.map((d) =>
    d.id === id ? { ...d, weight: w, locked: true } : next.has(d.id) ? { ...d, weight: next.get(d.id)! } : d
  );
}

/** Validate weights sent by the editor: 0–100 each, totalling 100 (±0.5). */
export function weightsProblem(weights: number[]): string | null {
  if (weights.some((w) => !Number.isFinite(w) || w < 0 || w > 100)) {
    return "Each weight must be between 0 and 100.";
  }
  const total = weights.reduce((s, w) => s + w, 0);
  if (Math.abs(total - 100) > 0.5) return `Weights must add up to 100% (they add up to ${round1(total)}%).`;
  return null;
}

// ── Progress ───────────────────────────────────────────────────────────────

export function subtaskProgress(status: SubtaskStatus): Progress {
  if (status === "done") return { approved: 100, pending: 0 };
  if (status === "review") return { approved: 0, pending: 100 };
  return ZERO;
}

function rollUp<T extends Weighted>(children: T[], each: (c: T) => Progress): Progress {
  const weights = effectiveWeights(children);
  let total = 0;
  let approved = 0;
  let pending = 0;
  for (const c of children) {
    const w = weights.get(c.id) ?? 0;
    if (w <= 0) continue;
    const p = each(c);
    total += w;
    approved += w * p.approved;
    pending += w * p.pending;
  }
  return total > 0 ? { approved: approved / total, pending: pending / total } : ZERO;
}

export interface SubtaskForProgress extends Weighted {
  status: SubtaskStatus;
}

/**
 * A task's progress: Done is 100%. With subtasks, the weighted share the task
 * owner has approved. Without subtasks it is the task itself: waiting for
 * review counts as pending, anything else as nothing yet.
 */
export function taskProgress(status: TaskStatus, subtasks: SubtaskForProgress[]): Progress {
  if (status === "done") return { approved: 100, pending: 0 };
  const live = subtasks.filter((s) => s.status !== "cancelled");
  if (live.length === 0) return status === "review" ? { approved: 0, pending: 100 } : ZERO;
  return rollUp(
    subtasks.map((s) => ({ ...s, cancelled: s.status === "cancelled" })),
    (s) => subtaskProgress(s.status)
  );
}

export interface TaskForProgress extends Weighted {
  status: TaskStatus;
  /** The task's own progress (taskProgress()); without it, its status decides. */
  progress?: Progress;
}

/**
 * A project's progress: each task's approved share, by the task's weight. So
 * an approved subtask moves the project as soon as it moves its task — a
 * subtask worth half a task that is worth 40% of the project adds 20%. A Done
 * task counts in full; a task without subtasks waiting for review is pending.
 */
export function projectProgress(tasks: TaskForProgress[]): Progress {
  return rollUp(tasks, (t) =>
    t.status === "done"
      ? { approved: 100, pending: 0 }
      : (t.progress ?? (t.status === "review" ? { approved: 0, pending: 100 } : ZERO))
  );
}

// ── Review routing & automatic status changes ──────────────────────────────

/**
 * After a subtask changes, what should its task's status become? Returns
 * null to leave it alone.
 * - Every live subtask approved → the task goes to review (the owner's work
 *   is done; a project manager approves it).
 * - A task in review or Done gets a subtask that is not approved (added,
 *   reopened, sent back) → back to in progress.
 * - The first subtask started on a task still in To do → in progress.
 */
export function taskStatusAfterSubtaskChange(
  taskStatus: TaskStatus,
  subtasks: { status: SubtaskStatus }[]
): TaskStatus | null {
  const live = subtasks.filter((s) => s.status !== "cancelled");
  if (live.length === 0) return null;
  const allApproved = live.every((s) => s.status === "done");
  if (allApproved) return taskStatus === "todo" || taskStatus === "in_progress" ? "review" : null;
  if (taskStatus === "review" || taskStatus === "done") return "in_progress";
  if (taskStatus === "todo" && live.some((s) => s.status !== "todo")) return "in_progress";
  return null;
}

/**
 * What "Mark complete" does to a subtask: someone who would review it
 * themselves (the task owner) has it approved at once; anyone else sends it
 * to the task owner.
 */
export function subtaskSubmitOutcome(actorId: number, taskOwnerId: number | null): "done" | "review" {
  return taskOwnerId !== null && actorId === taskOwnerId ? "done" : "review";
}

// ── Schedule health ────────────────────────────────────────────────────────

export type Health = "on_track" | "at_risk" | "off_track" | "not_started" | "done" | "no_dates";

/**
 * Actual (approved) progress compared with the share of the schedule that
 * has elapsed. More than 10 points behind = at risk; more than 25 = off track.
 */
export function scheduleHealth(
  approvedPct: number,
  startDate: string | null,
  dueDate: string | null,
  today: string
): { health: Health; expected: number | null } {
  if (approvedPct >= 99.5) return { health: "done", expected: 100 };
  if (!startDate || !dueDate) return { health: "no_dates", expected: null };
  const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  const total = (day(dueDate) - day(startDate)) / 86_400_000;
  const elapsed = (day(today) - day(startDate)) / 86_400_000;
  if (elapsed < 0) return { health: "not_started", expected: 0 };
  const expected = total <= 0 ? 100 : Math.min(100, (elapsed / total) * 100);
  const gap = expected - approvedPct;
  return { health: gap > 25 ? "off_track" : gap > 10 ? "at_risk" : "on_track", expected };
}

/**
 * When will it finish at the pace so far? Approved % per day since the start
 * date, carried forward from today. Also the time used, for drawing "time
 * gone" against "work done". Dates are "YYYY-MM-DD"; day counts are whole
 * days, and the start day counts as a working day (so a day-one 10% gives a
 * pace, not a division by zero).
 *
 *   kind  done         — all approved
 *         no_start     — no start date: nothing to measure from
 *         not_started  — the start date is still ahead
 *         no_pace      — started, but nothing approved yet
 *         projected    — `eta` is the forecast finish
 */
export interface Forecast {
  kind: "done" | "no_start" | "not_started" | "no_pace" | "projected";
  /** Forecast finish date (projected only). */
  eta: string | null;
  /** eta − due in days: > 0 late, ≤ 0 on time (projected with a due date). */
  daysLate: number | null;
  /** Days from the start to today, the start day included (0 before it starts). */
  elapsedDays: number;
  /** Days from start to due, both included (null without both dates). */
  totalDays: number | null;
  /** Days from today to the due date (negative once it has passed). */
  daysLeft: number | null;
  /** Share of the planned time used, 0–100 (null without both dates). */
  timePct: number | null;
}

const DAY_MS = 86_400_000;
const dayNum = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY_MS;
const fromDayNum = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

export function forecast(approvedPct: number, startDate: string | null, dueDate: string | null, today: string): Forecast {
  const t = dayNum(today);
  const s = startDate ? dayNum(startDate) : null;
  const d = dueDate ? dayNum(dueDate) : null;
  const totalDays = s !== null && d !== null ? Math.max(1, d - s + 1) : null;
  const elapsedDays = s === null ? 0 : Math.max(0, t - s + 1);
  const daysLeft = d === null ? null : d - t;
  const timePct = totalDays === null ? null : Math.max(0, Math.min(100, (elapsedDays / totalDays) * 100));
  const base = { eta: null, daysLate: null, elapsedDays, totalDays, daysLeft, timePct };

  if (approvedPct >= 99.5) return { kind: "done", ...base };
  if (s === null) return { kind: "no_start", ...base };
  if (t < s) return { kind: "not_started", ...base };
  if (approvedPct <= 0) return { kind: "no_pace", ...base };

  const perDay = approvedPct / elapsedDays;
  // Nearest whole day: rounding up would call work that is exactly on pace late.
  const etaNum = t + Math.round((100 - approvedPct) / perDay);
  return { kind: "projected", ...base, eta: fromDayNum(etaNum), daysLate: d === null ? null : etaNum - d };
}

// ── Small helpers ──────────────────────────────────────────────────────────

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
