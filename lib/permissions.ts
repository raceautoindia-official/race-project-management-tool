/**
 * lib/permissions.ts — who may do what to a subtask or to weights, in one
 * place. Pure (no database): callers load the facts, this decides.
 *
 * Roles on the spine (docs/IMPLEMENTATION_MAPPING.md §1):
 * - Manager: an admin, a project lead, or the project owner (the owner is
 *   always kept as a lead too; it is checked explicitly here as well).
 * - Task owner: the task's assignee ("Assigned owner" in the UI). Splits the
 *   task into subtasks, assigns them, sets their weights, reviews them.
 * - Subtask assignee: does the work and marks it complete.
 *
 * Project-level task rules (create, Done, sign-off…) stay in lib/rbac.ts and
 * lib/workflow.ts, unchanged.
 */

export interface SpineContext {
  userId: number;
  isAdmin: boolean;
  projectRole: "lead" | "member" | null;
  projectOwnerId: number | null;
  /** The task's assignee — its owner. */
  taskOwnerId?: number | null;
  /** For subtask actions: the subtask's assignee. */
  subtaskAssigneeId?: number | null;
}

export type SpineAction =
  | "task.weights" // adjust the weights of a project's tasks
  | "subtask.create" // add, rename, describe, date, delete, cancel
  | "subtask.assign"
  | "subtask.weights" // adjust the weights of a task's subtasks
  | "subtask.work" // start, mark complete
  | "subtask.review" // approve or send back
  | "subtask.reopen"; // reopen an approved subtask

export function isManager(c: SpineContext): boolean {
  return c.isAdmin || c.projectRole === "lead" || (c.projectOwnerId !== null && c.userId === c.projectOwnerId);
}

export function isTaskOwner(c: SpineContext): boolean {
  return c.taskOwnerId != null && c.userId === c.taskOwnerId;
}

/** Who reviews a subtask: its task's owner, or the managers if it has none. */
export function isSubtaskReviewer(c: SpineContext): boolean {
  if (c.isAdmin) return true;
  if (c.taskOwnerId == null) return isManager(c);
  return isTaskOwner(c);
}

export function can(action: SpineAction, c: SpineContext): boolean {
  switch (action) {
    case "task.weights":
      return isManager(c);
    case "subtask.create":
    case "subtask.assign":
    case "subtask.weights":
    case "subtask.reopen":
      return isManager(c) || isTaskOwner(c);
    case "subtask.work":
      return (
        isManager(c) ||
        isTaskOwner(c) ||
        (c.subtaskAssigneeId != null && c.userId === c.subtaskAssigneeId)
      );
    case "subtask.review":
      return isSubtaskReviewer(c);
  }
}

/** The message shown when an action is refused, in plain words. */
export const CANNOT: Record<SpineAction, string> = {
  "task.weights": "Only the project owner, a lead or an admin can change task weights.",
  "subtask.create": "Only the task owner, the project owner, a lead or an admin can change this task's subtasks.",
  "subtask.assign": "Only the task owner, the project owner, a lead or an admin can assign subtasks.",
  "subtask.weights": "Only the task owner, the project owner, a lead or an admin can change subtask weights.",
  "subtask.work": "Only the person this subtask is assigned to (or the task owner) can work on it.",
  "subtask.review": "Only the task owner reviews its subtasks.",
  "subtask.reopen": "Only the task owner, the project owner, a lead or an admin can reopen a subtask.",
};
