import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

type Params = { params: Promise<{ id: string }> };

async function loadTaskRef(taskId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT id, project_id, title FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  if (!rows.length) throw new ApiError(404, "Task not found");
  return rows[0];
}

/** GET — attachment metadata for a task (no blob data). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    await assertProjectAccess(user, task.project_id);

    const rows = await query<DbRow[]>(
      `SELECT a.id, a.filename, a.mime_type, a.size_bytes, a.created_at,
              a.uploaded_by, u.name AS uploader_name
         FROM task_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.task_id = ? ORDER BY a.created_at DESC`,
      [taskId]
    );
    return json({ attachments: rows });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST (multipart 'file') — upload an attachment (any project member). */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    await assertProjectAccess(user, task.project_id);

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) {
      throw new ApiError(400, "No file uploaded (form field 'file')");
    }
    if (file.size === 0) throw new ApiError(400, "File is empty");
    if (file.size > MAX_BYTES) {
      throw new ApiError(400, "File too large (max 10 MB)");
    }
    const name =
      (file instanceof File && file.name ? file.name : "attachment").slice(0, 255);
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = (await query<DbResult>(
      `INSERT INTO task_attachments (task_id, uploaded_by, filename, mime_type, size_bytes, data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [taskId, user.id, name, file.type || null, buffer.length, buffer]
    )) as unknown as DbResult;

    await logActivity({
      userId: user.id,
      action: "task.attachment_added",
      entityType: "task",
      entityId: taskId,
      metadata: { filename: name },
    });

    const [row] = await query<DbRow[]>(
      `SELECT a.id, a.filename, a.mime_type, a.size_bytes, a.created_at,
              a.uploaded_by, u.name AS uploader_name
         FROM task_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.id = ?`,
      [result.insertId]
    );
    return json({ attachment: row }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
