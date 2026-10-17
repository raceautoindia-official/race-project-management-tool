import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB, as for task attachments

type Params = { params: Promise<{ id: string }> };

/**
 * Files that belong to the project itself — the brief, the drawing, the
 * customer's email — rather than to one of its tasks.
 */

/** GET — attachment metadata for a project (no blob data). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const projectId = Number((await params).id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectAccess(user, projectId);

    const rows = await query<DbRow[]>(
      `SELECT a.id, a.filename, a.mime_type, a.size_bytes, a.created_at,
              a.uploaded_by, u.name AS uploader_name
         FROM project_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.project_id = ? ORDER BY a.created_at DESC`,
      [projectId]
    );
    return json({ attachments: rows });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST (multipart 'file') — attach a file to the project (any member). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const projectId = Number((await params).id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectAccess(user, projectId);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) {
      throw new ApiError(400, "No file uploaded (form field 'file')");
    }
    if (file.size === 0) throw new ApiError(400, "File is empty");
    if (file.size > MAX_BYTES) throw new ApiError(400, "File too large (max 10 MB)");

    const name =
      (file instanceof File && file.name ? file.name : "attachment").slice(0, 255);
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = (await query<DbResult>(
      `INSERT INTO project_attachments
         (project_id, uploaded_by, filename, mime_type, size_bytes, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, user.id, name, file.type || null, buffer.length, buffer]
    )) as unknown as DbResult;

    await logActivity({
      userId: user.id,
      action: "project.attachment_added",
      entityType: "project",
      entityId: projectId,
      metadata: { filename: name },
    });

    const [row] = await query<DbRow[]>(
      `SELECT a.id, a.filename, a.mime_type, a.size_bytes, a.created_at,
              a.uploaded_by, u.name AS uploader_name
         FROM project_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.id = ?`,
      [result.insertId]
    );
    return json({ attachment: row }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
