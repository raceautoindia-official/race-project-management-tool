import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict, forbidden } from "@/lib/http";
import { assertProjectWritable, assertRequestVisible } from "@/lib/rbac";
import { requestAttachmentsFor, saveRequestAttachment } from "@/lib/attachments";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function requestIdOf(params: Params["params"]): Promise<number> {
  const { id } = await params;
  const requestId = Number(id);
  if (!Number.isInteger(requestId)) throw new ApiError(400, "Invalid id");
  return requestId;
}

/** GET — the files sent with a request (its raiser and the project's leads). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const requestId = await requestIdOf(params);
    await assertRequestVisible(user, requestId);
    const files = await requestAttachmentsFor([requestId]);
    return json({ attachments: files.get(requestId) ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST (multipart 'file') — the person who raised a request adds a file to
 * it while it waits for a decision.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const requestId = await requestIdOf(params);
    const { request, project } = await assertRequestVisible(user, requestId);
    assertProjectWritable(project);
    if (request.requested_by !== user.id) {
      throw forbidden("Only the person who raised this request can add files to it");
    }
    if (request.status !== "pending") {
      throw conflict("This request has already been decided — add files to its task instead");
    }

    const attachment = await saveRequestAttachment(req, user, requestId);
    await logActivity({
      userId: user.id,
      action: "task_request.attachment_added",
      entityType: "project",
      entityId: request.project_id,
      metadata: { requestId, filename: attachment.filename },
    });
    return json({ attachment }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
