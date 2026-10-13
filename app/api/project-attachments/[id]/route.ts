import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError, forbidden, json } from "@/lib/http";
import { assertProjectAccess, canManageProject } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET — download a project file (any project member). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const attId = Number((await params).id);
    if (!Number.isInteger(attId)) throw new ApiError(400, "Invalid id");

    const [att] = await query<DbRow[]>(
      `SELECT filename, mime_type, data, project_id
         FROM project_attachments WHERE id = ? LIMIT 1`,
      [attId]
    );
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

/** DELETE — whoever uploaded it, or whoever runs the project. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const attId = Number((await params).id);
    if (!Number.isInteger(attId)) throw new ApiError(400, "Invalid id");

    const [att] = await query<DbRow[]>(
      `SELECT id, filename, uploaded_by, project_id
         FROM project_attachments WHERE id = ? LIMIT 1`,
      [attId]
    );
    if (!att) throw new ApiError(404, "Attachment not found");
    await assertProjectAccess(user, att.project_id);

    if (att.uploaded_by !== user.id && !(await canManageProject(user, att.project_id))) {
      throw forbidden("Only the person who attached it, or a project lead, can remove it");
    }
    await query(`DELETE FROM project_attachments WHERE id = ?`, [attId]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
