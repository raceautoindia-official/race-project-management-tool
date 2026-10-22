import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertTaskWritable } from "@/lib/rbac";
import { loadSubtaskContext } from "@/lib/subtasks";
import { listSubtaskAttachments, saveAttachment } from "@/lib/attachments";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Files on one subtask — anyone on the project may see and add them, the
 * same as a task's files. The reviewer uses this to send a marked-up file
 * back with "Request changes"; the assignee to hand in their work.
 *   GET  → { attachments }
 *   POST (multipart 'file') → { attachment }
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const subtaskId = Number((await params).id);
    if (!Number.isInteger(subtaskId)) throw new ApiError(400, "Invalid id");
    await loadSubtaskContext(user, subtaskId); // 404 / project access

    return json({ attachments: await listSubtaskAttachments(subtaskId) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const subtaskId = Number((await params).id);
    if (!Number.isInteger(subtaskId)) throw new ApiError(400, "Invalid id");
    const { task } = await loadSubtaskContext(user, subtaskId);
    await assertTaskWritable(task.id);

    return json({ attachment: await saveAttachment(req, user, task.id, subtaskId) }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
