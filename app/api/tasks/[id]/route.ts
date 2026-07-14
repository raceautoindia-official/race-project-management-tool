import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { assertProjectAccess, assertTaskEdit, canManageProject } from "@/lib/rbac";
import { updateTaskSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { attachTaskMeta, syncTaskLabels } from "@/lib/tasks";
import { projectAlertRecipients } from "@/lib/recipients";
import { sendEmail, emailLayout, appBaseUrl } from "@/lib/mailer";

type Params = { params: Promise<{ id: string }> };

const TASK_SELECT = `
  t.id, t.project_id, t.title, t.description, t.status, t.priority,
  t.outstanding, t.approval_status, t.approved_by, t.approved_at,
  t.estimated_hours, t.spent_hours, t.is_additional, t.parent_task_id,
  t.assignee_id, t.created_by, t.due_date, t.start_date, t.created_at, t.updated_at,
  a.name AS assignee_name, c.name AS creator_name, p.name AS project_name,
  (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
`;

// Fields a plain member (the task's assignee, but not a manager) may change.
// Hours are logged via /time-logs (not here), so status is all a member sets.
const MEMBER_EDITABLE = new Set(["status"]);

async function loadTask(taskId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT ${TASK_SELECT}
     FROM tasks t
     LEFT JOIN users a ON a.id = t.assignee_id
     LEFT JOIN users c ON c.id = t.created_by
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.id = ? LIMIT 1`,
    [taskId]
  );
  if (!rows.length) throw new ApiError(404, "Task not found");
  await attachTaskMeta(rows);
  return rows[0];
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTask(taskId);
    await assertProjectAccess(user, task.project_id);
    return json({ task: { ...task, comment_count: Number(task.comment_count) } });
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
    }

    if (data.assigneeId) {
      const m = await query<DbRow[]>(
        `SELECT id FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`,
        [task.project_id, data.assigneeId]
      );
      if (!m.length) {
        throw new ApiError(400, "Assignee must be a member of the project");
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
    }
    // Reopening a done task clears the completion stamp + approval.
    if (data.status !== undefined && data.status !== "done" && task.status === "done") {
      sets.push("completed_at = NULL");
      sets.push("approval_status = 'none'");
    }

    if (sets.length > 0) {
      values.push(taskId);
      await query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`, values);
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
            `<p><strong>${user.name}</strong> submitted <strong>${task.title}</strong> for your review.</p>
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
    return json({ task: { ...updated, comment_count: Number(updated.comment_count) } });
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
