import { query, DbRow, DbResult } from "@/lib/db";
import { ApiError } from "@/lib/http";
import { logActivity } from "@/lib/activity";
import type { User } from "@/lib/types";

/**
 * Files on a task — or on one of its subtasks (subtask_id set), e.g. a
 * marked-up drawing sent back with "Request changes". Both endpoints
 * (/api/tasks/:id/attachments and /api/subtasks/:id/attachments) save and
 * list through here, so a subtask's files also show on its task.
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const SELECT = `
  SELECT a.id, a.filename, a.mime_type, a.size_bytes, a.created_at,
         a.uploaded_by, u.name AS uploader_name,
         a.subtask_id, s.title AS subtask_title
    FROM task_attachments a
    LEFT JOIN users u ON u.id = a.uploaded_by
    LEFT JOIN subtasks s ON s.id = a.subtask_id`;

/** A task's files, its subtasks' included (newest first). */
export function listTaskAttachments(taskId: number): Promise<DbRow[]> {
  return query<DbRow[]>(`${SELECT} WHERE a.task_id = ? ORDER BY a.created_at DESC`, [taskId]);
}

/** One subtask's files (newest first). */
export function listSubtaskAttachments(subtaskId: number): Promise<DbRow[]> {
  return query<DbRow[]>(`${SELECT} WHERE a.subtask_id = ? ORDER BY a.created_at DESC`, [subtaskId]);
}

/**
 * Read the multipart field 'file' and store it. The caller has already
 * checked the person may see the project and that the task is writable.
 */
export async function saveAttachment(
  req: Request,
  user: User,
  taskId: number,
  subtaskId: number | null
): Promise<DbRow> {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) {
    throw new ApiError(400, "No file uploaded (form field 'file')");
  }
  if (file.size === 0) throw new ApiError(400, "File is empty");
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ApiError(400, "File too large (max 10 MB)");
  }
  const name = (file instanceof File && file.name ? file.name : "attachment").slice(0, 255);
  const buffer = Buffer.from(await file.arrayBuffer());

  const result = (await query<DbResult>(
    `INSERT INTO task_attachments (task_id, subtask_id, uploaded_by, filename, mime_type, size_bytes, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [taskId, subtaskId, user.id, name, file.type || null, buffer.length, buffer]
  )) as unknown as DbResult;

  await logActivity({
    userId: user.id,
    action: "task.attachment_added",
    entityType: "task",
    entityId: taskId,
    metadata: subtaskId ? { filename: name, subtaskId } : { filename: name },
  });

  const [row] = await query<DbRow[]>(`${SELECT} WHERE a.id = ?`, [result.insertId]);
  return row;
}
