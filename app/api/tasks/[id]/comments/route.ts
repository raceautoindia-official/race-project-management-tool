import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { createCommentSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { sendEmail, emailLayout, appBaseUrl } from "@/lib/mailer";

type Params = { params: Promise<{ id: string }> };

async function loadTaskProject(taskId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT id, project_id, title, assignee_id FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  const task = rows[0];
  if (!task) throw new ApiError(404, "Task not found");
  return task;
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTaskProject(taskId);
    await assertProjectAccess(user, task.project_id);

    const comments = await query<DbRow[]>(
      `SELECT tc.id, tc.task_id, tc.user_id, tc.body, tc.created_at, u.name AS user_name
       FROM task_comments tc
       JOIN users u ON u.id = tc.user_id
       WHERE tc.task_id = ?
       ORDER BY tc.created_at ASC`,
      [taskId]
    );
    return json({ comments });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const task = await loadTaskProject(taskId);
    await assertProjectAccess(user, task.project_id);

    const body = await req.json().catch(() => ({}));
    const { body: text, mentionIds } = createCommentSchema.parse(body);

    const result = (await query<DbResult>(
      `INSERT INTO task_comments (task_id, user_id, body) VALUES (?, ?, ?)`,
      [taskId, user.id, text]
    )) as unknown as DbResult;

    await logActivity({
      userId: user.id,
      action: "task.commented",
      entityType: "task",
      entityId: taskId,
    });

    // @mentions: notify + email each mentioned project member (deduped, not self).
    const mentioned = new Set<number>(
      (mentionIds ?? []).filter((mid) => mid !== user.id)
    );
    if (mentioned.size > 0) {
      const ids = [...mentioned];
      const placeholders = ids.map(() => "?").join(",");
      const members = await query<DbRow[]>(
        `SELECT u.id, u.email FROM project_members pm
           JOIN users u ON u.id = pm.user_id
          WHERE pm.project_id = ? AND u.id IN (${placeholders})`,
        [task.project_id, ...ids]
      );
      const link = `/projects/${task.project_id}`;
      for (const m of members) {
        await notify(
          m.id,
          "mention",
          `${user.name} mentioned you on "${task.title}"`,
          link
        );
        await sendEmail({
          to: m.email,
          subject: `${user.name} mentioned you: ${task.title}`,
          html: emailLayout(
            "You were mentioned",
            `<p><strong>${user.name}</strong> mentioned you in a comment on
             <strong>${task.title}</strong>:</p>
             <blockquote style="border-left:3px solid #e2e8f0;padding-left:12px;color:#475569;">${text}</blockquote>
             <p><a href="${appBaseUrl()}${link}">Open the task →</a></p>`
          ),
        });
      }
    }

    // Assignee still gets a plain comment notification (unless they were mentioned).
    if (
      task.assignee_id &&
      task.assignee_id !== user.id &&
      !mentioned.has(task.assignee_id)
    ) {
      await notify(
        task.assignee_id,
        "task_comment",
        `${user.name} commented on "${task.title}"`,
        `/projects/${task.project_id}`
      );
    }

    const rows = await query<DbRow[]>(
      `SELECT tc.id, tc.task_id, tc.user_id, tc.body, tc.created_at, u.name AS user_name
       FROM task_comments tc JOIN users u ON u.id = tc.user_id
       WHERE tc.id = ?`,
      [result.insertId]
    );
    return json({ comment: rows[0] }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
