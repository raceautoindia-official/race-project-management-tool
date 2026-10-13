import type { Task, TaskStatus } from "./types";

/** Nominal completion % for a task based purely on its workflow status. */
export const STATUS_PROGRESS: Record<TaskStatus, number> = {
  todo: 0,
  in_progress: 40,
  review: 75,
  done: 100,
};

/**
 * A single task's completion %: prefer its checklist ratio when it has
 * subtasks, otherwise fall back to a status-based estimate. `done` is always
 * 100%.
 */
export function taskProgress(
  task: Pick<
    Task,
    "status" | "subtask_total" | "subtask_done" | "estimated_hours" | "spent_hours"
  >
): number {
  if (task.status === "done") return 100;
  // Prefer a real signal: checklist ratio, else logged-vs-estimated hours.
  const total = task.subtask_total ?? 0;
  if (total > 0) return Math.round(((task.subtask_done ?? 0) / total) * 100);
  const est = Number(task.estimated_hours ?? 0);
  if (est > 0) {
    const spent = Number(task.spent_hours ?? 0);
    return Math.min(100, Math.round((spent / est) * 100));
  }
  // No estimate and no checklist → fall back to a nominal status step.
  return STATUS_PROGRESS[task.status];
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
 * How far a whole project has got, counted in checklist items.
 *
 * "Three of eight tasks done" is a blunt instrument: a task with its
 * checklist nine-tenths ticked counts for nothing, and a project can look
 * stalled on the day it is nearly finished. This counts the things people
 * actually tick off.
 *
 * Each task is worth as many units as it has checklist items, so a task with
 * twenty is worth ten times one with two — it is ten times the work. A task
 * with no checklist is worth one unit, earned when the task is marked Done,
 * which is the only evidence such a task offers. A task that is Done counts
 * in full whatever its checklist says, because the lead who marked it Done
 * has said so.
 */
export interface ProjectUnits {
  /** Checklist items across the project, counting a bare task as one. */
  units: number;
  /** Those that are ticked, or belong to a task already Done. */
  credited: number;
}

export function projectPercent(u: ProjectUnits | null | undefined): number {
  const units = Number(u?.units ?? 0);
  if (units <= 0) return 0;
  return Math.round((Number(u?.credited ?? 0) / units) * 100);
}

/** The same sum over tasks already loaded in the browser. */
export function projectUnitsOf(
  tasks: Pick<Task, "status" | "subtask_total" | "subtask_done">[]
): ProjectUnits {
  let units = 0;
  let credited = 0;
  for (const t of tasks) {
    const own = Math.max(Number(t.subtask_total ?? 0), 1);
    units += own;
    credited += t.status === "done" ? own : Number(t.subtask_done ?? 0);
  }
  return { units, credited };
}

/**
 * The same sum in SQL, for the lists that never load the tasks themselves.
 *
 * `tests/integration/project-progress.test.ts` asserts this and
 * projectUnitsOf() agree, so the two cannot drift apart unnoticed.
 */
export const PROJECT_UNITS_SQL = `
  (SELECT COALESCE(SUM(GREATEST(COALESCE(sc.total, 0), 1)), 0)
     FROM tasks t
     LEFT JOIN (SELECT task_id, COUNT(*) AS total FROM subtasks GROUP BY task_id) sc
       ON sc.task_id = t.id
    WHERE t.project_id = p.id)`;

export const PROJECT_CREDITED_SQL = `
  (SELECT COALESCE(SUM(
            CASE WHEN t.status = 'done' THEN GREATEST(COALESCE(sc.total, 0), 1)
                 ELSE COALESCE(sc.done, 0) END), 0)
     FROM tasks t
     LEFT JOIN (SELECT task_id, COUNT(*) AS total, SUM(is_done) AS done
                  FROM subtasks GROUP BY task_id) sc
       ON sc.task_id = t.id
    WHERE t.project_id = p.id)`;
