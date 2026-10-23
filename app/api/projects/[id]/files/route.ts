import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * Everything filed under a project, in one list.
 *
 * Files arrive in two places — on the project itself, and on its tasks — and
 * until now you had to remember which task someone attached the drawing to.
 * This is the shelf: both kinds, newest first, each saying where it came from
 * so you can still get back to the task it belongs to.
 *
 * Read-only. Uploading still happens where the file belongs.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const projectId = Number((await params).id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectAccess(user, projectId);

    const rows = await query<DbRow[]>(
      `SELECT a.id, a.filename, a.mime_type, a.size_bytes, a.created_at,
              a.uploaded_by, u.name AS uploader_name,
              'project' AS kind, NULL AS task_id, NULL AS task_title
         FROM project_attachments a
         LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.project_id = ?
        UNION ALL
       SELECT a.id, a.filename, a.mime_type, a.size_bytes, a.created_at,
              a.uploaded_by, u.name AS uploader_name,
              'task' AS kind, t.id AS task_id, t.title AS task_title
         FROM task_attachments a
         JOIN tasks t ON t.id = a.task_id
         LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE t.project_id = ?
        ORDER BY created_at DESC, id DESC`,
      [projectId, projectId]
    );
    return json({ files: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
