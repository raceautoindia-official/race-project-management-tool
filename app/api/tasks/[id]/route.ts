import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import {
  assertProjectAccess,
  assertNotReferencedBySignedOff,
  assertTaskEdit,
  assertTaskWritable,
  canManageProject,
} from "@/lib/rbac";
import { updateTaskSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { fetchTasks, syncTaskLabels } from "@/lib/tasks";
import { projectAlertRecipients } from "@/lib/recipients";
import { sendEmail, emailLayout, appBaseUrl, escapeHtml } from "@/lib/mailer";
import {
  missingSpecFields,
  normalizeSpec,
  SPEC_KEYS,
  specBodyKey,
  specFromBody,
} from "@/lib/workflow";
import type { SpecColumns, WorkType } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

// Fields a plain member (the task's assignee, but not a manager) may change.
// Hours are logged via /time-logs (not here), so status is all a member sets.
const MEMBER_EDITABLE = new Set(["status"]);

async function loadTask(taskId: number): Promise<DbRow> {
  const [task] = await fetchTasks("t.id = ?", [taskId]);
  if (!task) throw new ApiError(404, "Task not found");
  return task;
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTask(taskId);
    await assertProjectAccess(user, task.project_id);
    return json({ task });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTask(taskId);
    const { manager } = await assertTaskEdit(user, {
      project_id: task.project_id,
      assignee_id: task.assignee_id,
    });
    await assertTaskWritable(taskId);
    const body = await req.json().catch(() => ({}));
    const data = updateTaskSchema.parse(body);

    // A non-manager assignee may only touch status / logged hours.
    if (!manager) {
      const attempted = Object.keys(data);
      if (attempted.some((k) => !MEMBER_EDITABLE.has(k))) {
        throw forbidden(
          "You can only update the status and logged hours of your task"
        );
      }
      // Members submit for review; only an admin/lead marks a task Done.
      if (data.status === "done") {
        throw forbidden(
          "Submit the task for review — a project lead will approve and mark it Done."
        );
      }
      // …and only an admin/lead can take it back out of Done (it awaits sign-off).
      if (data.status !== undefined && data.status !== task.status && task.status === "done") {
        throw forbidden("This task is Done — only a project lead can reopen it.");
      }
    }

    // The requester is part of the approval trail: once the task is Done it
    // can't be rewritten (it can still be filled in if it was never recorded).
    const requesterChanging =
      data.requestedById != null && data.requestedById !== task.requested_by;
    if (requesterChanging && task.requested_by && task.status === "done") {
      throw new ApiError(409, "The requester can't be changed once the task is Done.");
    }

    const nextType = (data.taskType ?? task.task_type) as WorkType;
    const nextAssignee = data.assigneeId !== undefined ? data.assigneeId : task.assignee_id;
    if (
      nextType !== "general" &&
      !nextAssignee &&
      (data.assigneeId !== undefined || data.taskType !== undefined)
    ) {
      throw new ApiError(400, "An assigned owner is required");
    }
    for (const [field, userId] of [
      // Unchanged people stay valid even if they later left the project.
      ["Assignee", data.assigneeId === task.assignee_id ? null : data.assigneeId],
      ["The requester", data.requestedById === task.requested_by ? null : data.requestedById],
    ] as const) {
      if (!userId) continue;
      const m = await query<DbRow[]>(
        `SELECT id FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`,
        [task.project_id, userId]
      );
      if (!m.length && !(field === "The requester" && userId === user.id)) {
        throw new ApiError(400, `${field} must be a member of the project`);
      }
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.title !== undefined) {
      sets.push("title = ?");
      values.push(data.title);
    }
    if (data.description !== undefined) {
      sets.push("description = ?");
      values.push(data.description ?? null);
    }

    // Type / spec: validate the merged result so a partial update can't blank
    // a required field, and clear fields that don't belong to the type.
    const specTouched =
      data.taskType !== undefined ||
      SPEC_KEYS.some((k) => (data as Record<string, unknown>)[specBodyKey(k)] !== undefined);
    if (specTouched) {
      const merged: SpecColumns = {};
      for (const k of SPEC_KEYS) merged[k] = task[k];
      Object.assign(merged, specFromBody(data));
      const missing = missingSpecFields(nextType, merged);
      if (missing.length) {
        throw new ApiError(400, `${missing[0].label} is required`);
      }
      const spec = normalizeSpec(nextType, merged);
      sets.push("task_type = ?");
      values.push(nextType);
      for (const k of SPEC_KEYS) {
        sets.push(`${k} = ?`);
        values.push(spec[k]);
      }
    }
    if (data.requestedById !== undefined && data.requestedById !== null) {
      sets.push("requested_by = ?");
      values.push(data.requestedById);
    }
    if (data.status !== undefined) {
      sets.push("status = ?");
      values.push(data.status);
    }
    if (data.priority !== undefined) {
      sets.push("priority = ?");
      values.push(data.priority);
    }
    if (data.estimatedHours !== undefined) {
      sets.push("estimated_hours = ?");
      values.push(data.estimatedHours);
    }
    if (data.assigneeId !== undefined) {
      sets.push("assignee_id = ?");
      values.push(data.assigneeId);
    }
    if (data.dueDate !== undefined) {
      sets.push("due_date = ?");
      values.push(data.dueDate);
    }
    if (data.startDate !== undefined) {
      sets.push("start_date = ?");
      values.push(data.startDate);
    }

    // Review-gate transitions (Wave 7).
    const submittingReview =
      data.status === "review" && task.status !== "review";
    const approving = data.status === "done" && task.status !== "done";
    const sendingBack =
      data.status === "in_progress" && task.status === "review";

    // Approving (manager marks Done) clears the overdue/outstanding flag and
    // stamps the completion time (used for on-time performance stats).
    if (approving) {
      sets.push("outstanding = 0");
      sets.push("approval_status = 'approved'");
      sets.push("approved_by = ?");
      values.push(user.id);
      sets.push("approved_at = UTC_TIMESTAMP()");
      sets.push("completed_at = UTC_TIMESTAMP()");
      // A task with no recorded approver (e.g. its approver's account is gone)
      // gets the lead approving its completion, so it can still be signed off.
      if (!task.request_approved_by) {
        sets.push("request_approved_by = ?");
        values.push(user.id);
        sets.push("request_approved_at = UTC_TIMESTAMP()");
      }
    }
    // Reopening a done task clears the completion stamp + approval.
    if (data.status !== undefined && data.status !== "done" && task.status === "done") {
      sets.push("completed_at = NULL");
      sets.push("approval_status = 'none'");
    }

    if (sets.length > 0) {
      values.push(taskId);
      // Re-checked atomically: a sign-off that landed after the lock check wins.
      const res = (await query<DbResult>(
        `UPDATE tasks SET ${sets.join(", ")} WHERE id = ? AND signed_off_at IS NULL`,
        values
      )) as unknown as DbResult;
      if (res.affectedRows === 0) {
        throw new ApiError(409, "This task is signed off and read-only.");
      }
    }

    // Submit for review → notify the project lead(s) + admins (in-app + email).
    if (submittingReview) {
      const recipients = await projectAlertRecipients(task.project_id);
      const link = `/projects/${task.project_id}`;
      for (const r of recipients.filter((r) => r.id !== user.id)) {
        await notify(
          r.id,
          "review_requested",
          `${user.name} submitted "${task.title}" for review`,
          link
        );
        await sendEmail({
          to: [r.email],
          subject: `Review requested: ${task.title}`,
          html: emailLayout(
            "Task submitted for review",
            `<p><strong>${escapeHtml(user.name)}</strong> submitted <strong>${escapeHtml(task.title)}</strong> for your review.</p>
             <p><a href="${appBaseUrl()}${link}">Open the project →</a></p>`
          ),
        });
      }
    }
    // Approve / send-back → notify the assignee.
    if (approving && task.assignee_id && task.assignee_id !== user.id) {
      await notify(
        task.assignee_id,
        "task_approved",
        `Your task "${task.title}" was approved and marked done`,
        `/projects/${task.project_id}`
      );
    }
    // Done → the requester is asked to verify and sign off.
    if (approving && task.requested_by && task.requested_by !== user.id) {
      await notify(
        task.requested_by,
        "signoff_requested",
        `"${task.title}" is done — please verify and sign off`,
        `/projects/${task.project_id}`
      );
    }
    if (sendingBack && task.assignee_id && task.assignee_id !== user.id) {
      await notify(
        task.assignee_id,
        "task_sent_back",
        `"${task.title}" was sent back for changes`,
        `/projects/${task.project_id}`
      );
    }
    if (data.labelIds !== undefined) {
      await syncTaskLabels(taskId, task.project_id, data.labelIds);
    }

    if (requesterChanging) {
      await logActivity({
        userId: user.id,
        action: "task.requester_changed",
        entityType: "task",
        entityId: taskId,
        metadata: { title: task.title, from: task.requested_by, to: data.requestedById },
      });
    }

    const statusChanged =
      data.status !== undefined && data.status !== task.status;
    await logActivity({
      userId: user.id,
      action: statusChanged ? "task.status_changed" : "task.updated",
      entityType: "task",
      entityId: taskId,
      metadata: statusChanged
        ? { from: task.status, to: data.status, title: task.title }
        : { title: task.title },
    });

    if (
      data.assigneeId !== undefined &&
      data.assigneeId !== null &&
      data.assigneeId !== task.assignee_id &&
      data.assigneeId !== user.id
    ) {
      await notify(
        data.assigneeId,
        "task_assigned",
        `You were assigned: "${task.title}"`,
        `/projects/${task.project_id}`
      );
    }

    const updated = await loadTask(taskId);
    return json({ task: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTask(taskId);
    const { projectRole } = await assertProjectAccess(user, task.project_id);

    if (!canManageProject(user, projectRole)) {
      throw forbidden("Only an admin or project lead can delete this task");
    }
    await assertTaskWritable(taskId);
    await assertNotReferencedBySignedOff([taskId]);

    await query(`DELETE FROM tasks WHERE id = ?`, [taskId]);
    await logActivity({
      userId: user.id,
      action: "task.deleted",
      entityType: "task",
      entityId: taskId,
      metadata: { title: task.title, projectId: task.project_id },
    });

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
