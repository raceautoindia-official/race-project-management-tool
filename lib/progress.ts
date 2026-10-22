import type { Task, TaskStatus } from "./types";
import { effectiveWeights } from "./work-engine";

/**
 * Progress after the 2026-10-17 redesign: **only approved work counts**, and
 * each piece counts by its weight (docs/REDESIGN_PLAN.md §3).
 *
 * - A task's bar: the weighted share of its subtasks that its owner has
 *   approved (worked out by lib/tasks.ts attachTaskMeta with the engine in
 *   lib/work-engine.ts); a Done task is 100%. A task without subtasks shows
 *   nothing until it is Done — finishing it means sending it for review.
 * - A project's bar: each task's approved share, by the task's weight — so
 *   an approved subtask moves the project too, not only a finished task.
 *
 * The names below are the ones the app already used, so every list, card and
 * dashboard that showed checklist units now shows weighted, approved progress
 * without changing.
 */

/**
 * The old nominal % per status. Kept for anything that still wants a rough
 * "how far along" for a single status; progress bars no longer use it.
 */
export const STATUS_PROGRESS: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 40,
  review: 75,
  done: 100,
};

type ProgressFields = Pick<Task, "status" | "subtask_total" | "subtask_done"> & {
  progress_approved?: number | null;
};

/** A single task's approved completion %, 0–100. */
export function taskProgress(task: ProgressFields): number {
  if (task.status === "done") return 100;
  if (task.progress_approved != null) return Math.round(Number(task.progress_approved));
  // Rows that skipped attachTaskMeta: an even split of approved subtasks.
  const total = Number(task.subtask_total ?? 0);
  if (total > 0) return Math.round((Number(task.subtask_done ?? 0) / total) * 100);
  return 0;
}

/** Tally a task list into per-status counts (for the status breakdown bar). */
export function statusCounts(
  tasks: Pick<Task, "status">[]
): Record<TaskStatus, number> {
  const counts: Record<TaskStatus, number> = {
    todo: 0,
    in_progress: 0,
    review: 0,
    done: 0,
  };
  for (const t of tasks) counts[t.status]++;
  return counts;
}

/**
 * A project's progress as two numbers: the total of its tasks' effective
 * weights (`units`, 100 whenever it has tasks) and the share of that earned
 * by approved work (`credited`): each task's weight × its approved %.
 */
export interface ProjectUnits {
  units: number;
  credited: number;
}

export function projectPercent(u: ProjectUnits | null | undefined): number {
  const units = Number(u?.units ?? 0);
  if (units <= 0) return 0;
  return Math.round((Number(u?.credited ?? 0) / units) * 100);
}

/** The same sum over tasks already loaded in the browser. */
export function projectUnitsOf(
  tasks: (Pick<Task, "id" | "status"> & {
    weight?: number | string | null;
    weight_mode?: string | null;
    /** From attachTaskMeta; a task without it counts only once Done. */
    progress_approved?: number | null;
  })[]
): ProjectUnits {
  const weights = effectiveWeights(
    tasks.map((t) => ({
      id: t.id,
      weight: Number(t.weight ?? 0),
      weight_mode: t.weight_mode === "manual" ? "manual" : "auto",
    }))
  );
  let units = 0;
  let credited = 0;
  for (const t of tasks) {
    const w = weights.get(t.id) ?? 0;
    units += w;
    const share = t.status === "done" ? 100 : Math.max(0, Math.min(100, Number(t.progress_approved ?? 0)));
    credited += (w * share) / 100;
  }
  return { units, credited };
}

/**
 * Each task's effective weight in SQL (alias `t`): a manual weight as set; an
 * automatic one gets an even share of what the manual ones leave.
 */
const EFFECTIVE_WEIGHT_SQL = `
  CASE WHEN t.weight_mode = 'manual' THEN t.weight
       ELSE GREATEST(0, 100 - (SELECT COALESCE(SUM(m.weight), 0) FROM tasks m
                                WHERE m.project_id = t.project_id AND m.weight_mode = 'manual'))
            / (SELECT COUNT(*) FROM tasks a
                WHERE a.project_id = t.project_id AND a.weight_mode = 'auto') END`;

/**
 * The same sum in SQL (alias `p` for the project), for the lists that never
 * load the tasks themselves.
 *
 * `tests/integration/project-progress.test.ts` asserts this and
 * projectUnitsOf() agree, so the two cannot drift apart unnoticed.
 */
export const PROJECT_UNITS_SQL = `
  (SELECT COALESCE(SUM(${EFFECTIVE_WEIGHT_SQL}), 0)
     FROM tasks t
    WHERE t.project_id = p.id)`;

/** A live subtask's effective weight in SQL (alias `s`, its task `t`). */
const SUBTASK_WEIGHT_SQL = `
  CASE WHEN s.weight_mode = 'manual' THEN s.weight
       ELSE GREATEST(0, 100 - (SELECT COALESCE(SUM(m.weight), 0) FROM subtasks m
                                WHERE m.task_id = t.id AND m.status <> 'cancelled' AND m.weight_mode = 'manual'))
            / (SELECT COUNT(*) FROM subtasks a
                WHERE a.task_id = t.id AND a.status <> 'cancelled' AND a.weight_mode = 'auto') END`;

/** A task's approved fraction, 0–1 (alias `t`): Done is 1, else its approved subtasks' share. */
const TASK_APPROVED_FRACTION_SQL = `
  CASE WHEN t.status = 'done' THEN 1
       ELSE COALESCE((SELECT SUM(CASE WHEN s.status = 'done' THEN ${SUBTASK_WEIGHT_SQL} ELSE 0 END)
                             / NULLIF(SUM(${SUBTASK_WEIGHT_SQL}), 0)
                        FROM subtasks s
                       WHERE s.task_id = t.id AND s.status <> 'cancelled'), 0) END`;

export const PROJECT_CREDITED_SQL = `
  (SELECT COALESCE(SUM((${EFFECTIVE_WEIGHT_SQL}) * (${TASK_APPROVED_FRACTION_SQL})), 0)
     FROM tasks t
    WHERE t.project_id = p.id)`;
