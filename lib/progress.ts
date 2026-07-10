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
  task: Pick<Task, "status" | "subtask_total" | "subtask_done">
): number {
  if (task.status === "done") return 100;
  const total = task.subtask_total ?? 0;
  if (total > 0) return Math.round(((task.subtask_done ?? 0) / total) * 100);
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
