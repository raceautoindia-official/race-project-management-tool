import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict, forbidden } from "@/lib/http";
import { assertProjectAccess, assertProjectWritable } from "@/lib/rbac";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/requests/:id — the requester withdraws their pending request. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const requestId = Number(id);
    if (!Number.isInteger(requestId)) throw new ApiError(400, "Invalid id");

    const [request] = await query<DbRow[]>(
      `SELECT id, project_id, title, status, requested_by
         FROM task_requests WHERE id = ? LIMIT 1`,
      [requestId]
    );
    if (!request) throw new ApiError(404, "Request not found");
    const { project } = await assertProjectAccess(user, request.project_id);
    assertProjectWritable(project);
    if (request.requested_by !== user.id) {
      throw forbidden("Only the person who raised this request can withdraw it");
    }

    const res = (await query<DbResult>(
      `DELETE FROM task_requests WHERE id = ? AND status = 'pending'`,
      [requestId]
    )) as unknown as DbResult;
    if (res.affectedRows === 0) {
      throw conflict("This request has already been decided and can't be withdrawn");
    }

    await logActivity({
      userId: user.id,
      action: "task_request.withdrawn",
      entityType: "project",
      entityId: request.project_id,
      metadata: { requestId, title: request.title },
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
