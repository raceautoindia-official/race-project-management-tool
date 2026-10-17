import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertTaskWritable } from "@/lib/rbac";
import { updateSubtaskSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import {
  assertCan,
  assertProjectMember,
  listSubtasks,
  loadSubtaskContext,
  subtaskLink,
  syncTaskAfterSubtaskChange,
} from "@/lib/subtasks";
import { applySubtaskAction } from "@/lib/subtask-actions";

type Params = { params: Promise<{ id: string }> };

function idOf(id: string): number {
  const n = Number(id);
  if (!Number.isInteger(n)) throw new ApiError(400, "Invalid id");
  return n;
}

/**
 * PATCH /api/subtasks/:id — edit a subtask: title, description, assignee,
 * dates (task owner / managers). `is_done` is still accepted from older
 * screens: ticking means "mark complete" (approved at once when the task
 * owner ticks), unticking means reopen. The review flow proper is
 * POST /api/subtasks/:id/actions.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const subtaskId = idOf((await params).id);
    const { sub, task, ctx } = await loadSubtaskContext(user, subtaskId);
    await assertTaskWritable(task.id);
    const data = updateSubtaskSchema.parse(await req.json().catch(() => ({})));

    const sets: string[] = [];
    const values: unknown[] = [];
    const edits = (["title", "description", "startDate", "dueDate"] as const).filter((k) => data[k] !== undefined);
    if (edits.length) {
      assertCan("subtask.create", ctx);
      if (data.title !== undefined) { sets.push("title = ?"); values.push(data.title); }
      if (data.description !== undefined) { sets.push("description = ?"); values.push(data.description ?? null); }
      if (data.startDate !== undefined) { sets.push("start_date = ?"); values.push(data.startDate); }
      if (data.dueDate !== undefined) {
        sets.push("due_date = ?", "due_alert_sent = 0"); // a new date gets its own reminders
        values.push(data.dueDate);
      }
    }
    // One date alone still has to fit the other, stored one.
    const start = data.startDate !== undefined ? data.startDate : sub.start_date;
    const due = data.dueDate !== undefined ? data.dueDate : sub.due_date;
    if (start && due && due < start) throw new ApiError(400, "The due date can't be before the start date");

    const reassigning = data.assigneeId !== undefined && data.assigneeId !== sub.assignee_id;
    if (reassigning) {
      assertCan("subtask.assign", ctx);
      if (data.assigneeId) await assertProjectMember(task.project_id, data.assigneeId);
      sets.push("assignee_id = ?");
      values.push(data.assigneeId ?? null);
    }

    if (sets.length) {
      values.push(subtaskId);
      await query(`UPDATE subtasks SET ${sets.join(", ")} WHERE id = ?`, values);
      await logActivity({
        userId: user.id,
        action: "subtask.updated",
        entityType: "task",
        entityId: task.id,
        metadata: { subtaskId, fields: [...edits, ...(reassigning ? ["assigneeId"] : [])] },
      });
      if (reassigning && data.assigneeId && data.assigneeId !== user.id) {
        await notify(
          data.assigneeId,
          "subtask_assigned",
          `"${data.title ?? sub.title}" (in "${task.title}") was assigned to you`,
          subtaskLink(task.project_id, task.id, subtaskId)
        );
      }
    }

    // Older screens tick and untick.
    if (data.is_done !== undefined) {
      const status = sub.status as string;
      if (data.is_done && (status === "todo" || status === "in_progress")) {
        await applySubtaskAction(user, subtaskId, "submit");
      } else if (data.is_done && status === "review") {
        await applySubtaskAction(user, subtaskId, "approve");
      } else if (!data.is_done && (status === "done" || status === "review")) {
        await applySubtaskAction(user, subtaskId, "reopen");
      }
    }

    const subtask = (await listSubtasks(task.id)).find((s) => s.id === subtaskId);
    return json({ subtask });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/subtasks/:id — task owner / managers. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const subtaskId = idOf((await params).id);
    const { sub, task, ctx } = await loadSubtaskContext(user, subtaskId);
    assertCan("subtask.create", ctx);
    await assertTaskWritable(task.id);

    await query(`DELETE FROM subtasks WHERE id = ?`, [subtaskId]);
    await logActivity({
      userId: user.id,
      action: "subtask.deleted",
      entityType: "task",
      entityId: task.id,
      metadata: { subtaskId, title: sub.title },
    });
    // Deleting the last open subtask can complete the task's work.
    await syncTaskAfterSubtaskChange(task.id, user);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
