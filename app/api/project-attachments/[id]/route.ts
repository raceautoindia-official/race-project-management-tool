import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { errorResponse, ApiError, forbidden, json } from "@/lib/http";
import { assertProjectAccess, canManageProject } from "@/lib/rbac";
import { dispositionFor } from "@/lib/inline-files";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** GET — download a project file (any project member). */
export async function GET(req: NextRequest, { params }: Params) {
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
    // A gallery thumbnail asks for the picture itself; everything else, and
    // every type that is not a plain image, still downloads.
    const wantsInline = new URL(req.url).searchParams.get("inline") === "1";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": att.mime_type || "application/octet-stream",
        "Content-Disposition": dispositionFor(
          att.mime_type,
          wantsInline,
          String(att.filename)
        ),
        "Content-Length": String(data.length),
        "X-Content-Type-Options": "nosniff",
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
    const { project, projectRole } = await assertProjectAccess(user, att.project_id);
    // A lead (or the project owner, or an admin) may tidy up anyone's upload.
    const manager = canManageProject(user, projectRole) || project.owner_id === user.id;

    if (att.uploaded_by !== user.id && !manager) {
      throw forbidden("Only the person who attached it, or a project lead, can remove it");
    }
    await query(`DELETE FROM project_attachments WHERE id = ?`, [attId]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
