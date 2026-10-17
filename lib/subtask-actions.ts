import { query, DbResult } from "./db";
import { conflict, badRequest } from "./http";
import { assertTaskWritable } from "./rbac";
import { logActivity, notify } from "./activity";
import { subtaskSubmitOutcome, type SubtaskStatus } from "./work-engine";
import { assertCan, assertMayReopenTask, loadSubtaskContext, subtaskLink, syncTaskAfterSubtaskChange } from "./subtasks";
import type { User } from "./types";

export type SubtaskAction = "start" | "submit" | "approve" | "request_changes" | "reopen" | "cancel" | "restore";

/** Which statuses each action may start from. */
const FROM: Record<SubtaskAction, SubtaskStatus[]> = {
  start: ["todo"],
  submit: ["todo", "in_progress"],
  approve: ["review"],
  request_changes: ["review"],
  reopen: ["done", "review"],
  cancel: ["todo", "in_progress", "review"],
  restore: ["cancelled"],
};

const VERB: Record<SubtaskAction, string> = {
  start: "start",
  submit: "mark complete",
  approve: "approve",
  request_changes: "send back",
  reopen: "reopen",
  cancel: "cancel",
  restore: "restore",
};

/**
 * Move a subtask through its review flow and keep its task in step.
 *
 *   start            todo → in_progress                        (assignee / task owner / manager)
 *   submit           → review, sent to the task owner;
 *                    → done at once when the task owner submits  (same people)
 *   approve          review → done (counts toward progress)     (task owner)
 *   request_changes  review → in_progress, with a note          (task owner)
 *   reopen           done / review → in_progress                (task owner / manager)
 *   cancel, restore  drop it out of the weighting / bring it back (task owner / manager)
 *
 * Every write is guarded on the status just read, so two people acting at
 * once can't both win. Returns the new status.
 */
export async function applySubtaskAction(
  user: User,
  subtaskId: number,
  action: SubtaskAction,
  note?: string | null
): Promise<SubtaskStatus> {
  const { sub, task, ctx } = await loadSubtaskContext(user, subtaskId);
  await assertTaskWritable(task.id);

  const permission =
    action === "approve" || action === "request_changes"
      ? "subtask.review"
      : action === "reopen"
        ? // Pulling back your own submission is part of doing the work;
          // reopening approved work is the task owner's call.
          sub.status === "review"
          ? "subtask.work"
          : "subtask.reopen"
        : action === "cancel" || action === "restore"
          ? "subtask.create"
          : "subtask.work";
  assertCan(permission, ctx);
  if (action === "reopen" || action === "restore") assertMayReopenTask(task, ctx);

  const from = sub.status as SubtaskStatus;
  if (!FROM[action].includes(from)) {
    throw conflict(`This subtask can't ${VERB[action]} from "${from.replace("_", " ")}"`);
  }
  if (action === "request_changes" && !note) throw badRequest("Say what needs to change");

  let to: SubtaskStatus;
  let sets = "";
  const values: unknown[] = [];
  switch (action) {
    case "start":
      to = "in_progress";
      break;
    case "submit":
      to = subtaskSubmitOutcome(user.id, task.assignee_id);
      sets = ", submitted_at = UTC_TIMESTAMP(), changes_requested = NULL";
      if (to === "done") {
        sets += ", approved_by = ?, approved_at = UTC_TIMESTAMP()";
        values.push(user.id);
      }
      break;
    case "approve":
      to = "done";
      sets = ", approved_by = ?, approved_at = UTC_TIMESTAMP(), changes_requested = NULL";
      values.push(user.id);
      break;
    case "request_changes":
      to = "in_progress";
      sets = ", changes_requested = ?, submitted_at = NULL";
      values.push(note);
      break;
    case "reopen":
      to = "in_progress";
      sets = ", approved_by = NULL, approved_at = NULL, submitted_at = NULL";
      break;
    case "cancel":
      to = "cancelled";
      break;
    case "restore":
      to = "todo";
      sets = ", approved_by = NULL, approved_at = NULL, submitted_at = NULL";
      break;
  }

  const res = (await query<DbResult>(
    `UPDATE subtasks SET status = ?, is_done = ?${sets} WHERE id = ? AND status = ?`,
    [to, to === "done", ...values, subtaskId, from]
  )) as unknown as DbResult;
  if (res.affectedRows === 0) throw conflict("Someone else changed this subtask first — reload and try again");

  await logActivity({
    userId: user.id,
    action: `subtask.${action}`,
    entityType: "task",
    entityId: task.id,
    metadata: { subtaskId, title: sub.title, from, to, note: note ?? null },
  });

  // Tell the next person in the chain.
  const link = subtaskLink(task.project_id, task.id, subtaskId);
  const title = `"${sub.title}"`;
  const assignee = sub.assignee_id as number | null;
  if (action === "submit" && to === "review" && task.assignee_id && task.assignee_id !== user.id) {
    await notify(task.assignee_id, "subtask_submitted", `${user.name} finished ${title} — it needs your review`, link);
  } else if (assignee && assignee !== user.id) {
    if (action === "approve") await notify(assignee, "subtask_approved", `${title} was approved`, link);
    if (action === "request_changes") await notify(assignee, "subtask_changes_requested", `Changes requested on ${title}: ${note}`, link);
    if (action === "reopen") await notify(assignee, "subtask_reopened", `${title} was reopened`, link);
  }

  await syncTaskAfterSubtaskChange(task.id, user);
  return to;
}
