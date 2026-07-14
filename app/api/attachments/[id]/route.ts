import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError, forbidden, json } from "@/lib/http";
import { assertProjectAccess, canManageProject } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET /api/attachments/:id — download the file (any project member). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const attId = Number(id);
    if (!Number.isInteger(attId)) throw new ApiError(400, "Invalid id");

    const rows = await query<DbRow[]>(
      `SELECT a.filename, a.mime_type, a.data, t.project_id
         FROM task_attachments a JOIN tasks t ON t.id = a.task_id
        WHERE a.id = ? LIMIT 1`,
      [attId]
    );
    const att = rows[0];
    if (!att) throw new ApiError(404, "Attachment not found");
    await assertProjectAccess(user, att.project_id);

    const data: Buffer = att.data;
    const safe = String(att.filename).replace(/[^\w.\- ]+/g, "_");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": att.mime_type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safe}"`,
        "Content-Length": String(data.length),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/attachments/:id — uploader or admin/lead. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const attId = Number(id);
    if (!Number.isInteger(attId)) throw new ApiError(400, "Invalid id");

    const rows = await query<DbRow[]>(
      `SELECT a.uploaded_by, t.project_id
         FROM task_attachments a JOIN tasks t ON t.id = a.task_id
        WHERE a.id = ? LIMIT 1`,
      [attId]
    );
    const att = rows[0];
    if (!att) throw new ApiError(404, "Attachment not found");

    const { projectRole } = await assertProjectAccess(user, att.project_id);
    if (!canManageProject(user, projectRole) && att.uploaded_by !== user.id) {
      throw forbidden("You can only delete your own attachments");
    }

    await query(`DELETE FROM task_attachments WHERE id = ?`, [attId]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
