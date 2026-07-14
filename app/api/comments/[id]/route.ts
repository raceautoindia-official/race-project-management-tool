import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { assertProjectAccess, canManageProject } from "@/lib/rbac";
import { createCommentSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

async function loadComment(commentId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT tc.id, tc.task_id, tc.user_id, tc.body, t.project_id
       FROM task_comments tc JOIN tasks t ON t.id = tc.task_id
      WHERE tc.id = ? LIMIT 1`,
    [commentId]
  );
  if (!rows.length) throw new ApiError(404, "Comment not found");
  return rows[0];
}

/** PATCH /api/comments/:id — the author edits their own comment. */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const commentId = Number(id);
    if (!Number.isInteger(commentId)) throw new ApiError(400, "Invalid id");

    const comment = await loadComment(commentId);
    await assertProjectAccess(user, comment.project_id);
    if (comment.user_id !== user.id) {
      throw forbidden("You can only edit your own comment");
    }

    const { body } = createCommentSchema.parse(await req.json().catch(() => ({})));
    await query(
      `UPDATE task_comments SET body = ?, edited_at = UTC_TIMESTAMP() WHERE id = ?`,
      [body, commentId]
    );

    const [row] = await query<DbRow[]>(
      `SELECT tc.id, tc.task_id, tc.user_id, tc.body, tc.created_at, tc.edited_at,
              u.name AS user_name
         FROM task_comments tc JOIN users u ON u.id = tc.user_id
        WHERE tc.id = ?`,
      [commentId]
    );
    return json({ comment: row });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/comments/:id — the author or an admin/project lead. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const commentId = Number(id);
    if (!Number.isInteger(commentId)) throw new ApiError(400, "Invalid id");

    const comment = await loadComment(commentId);
    const { projectRole } = await assertProjectAccess(user, comment.project_id);
    if (!canManageProject(user, projectRole) && comment.user_id !== user.id) {
      throw forbidden("You can only delete your own comment");
    }

    await query(`DELETE FROM task_comments WHERE id = ?`, [commentId]);
    await logActivity({
      userId: user.id,
      action: "task.comment_deleted",
      entityType: "task",
      entityId: comment.task_id,
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
