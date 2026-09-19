import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict, forbidden } from "@/lib/http";
import { findProject } from "@/lib/rbac";
import { decisionSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { canDecideProject } from "@/lib/workflow";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/decision { decision: approve|reject, note? }
 * The nominated lead (project owner) or an admin approves or rejects a pending
 * project request. Approval unlocks the project; rejection keeps it read-only.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const project = await findProject(projectId);
    if (!project) throw new ApiError(404, "Project not found");
    if (!canDecideProject(user, { owner_id: project.owner_id })) {
      throw forbidden("Only the nominated lead or an admin can decide this request");
    }

    const { decision, note } = decisionSchema.parse(
      await req.json().catch(() => ({}))
    );

    const status = decision === "approve" ? "approved" : "rejected";
    // Guarded on pending so two deciders can't both win.
    const res = (await query<DbResult>(
      `UPDATE projects
          SET approval_status = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(),
              decision_note = ?
        WHERE id = ? AND approval_status = 'pending'`,
      [status, user.id, note || null, projectId]
    )) as unknown as DbResult;
    if (res.affectedRows === 0) {
      throw conflict("This project request has already been decided");
    }

    await logActivity({
      userId: user.id,
      action: decision === "approve" ? "project.approved" : "project.rejected",
      entityType: "project",
      entityId: projectId,
      metadata: { name: project.name, note: note || null },
    });

    if (project.requested_by && project.requested_by !== user.id) {
      await notify(
        project.requested_by,
        decision === "approve" ? "project_approved" : "project_rejected",
        decision === "approve"
          ? `Your project "${project.name}" was approved by ${user.name}`
          : `Your project "${project.name}" was rejected${note ? `: ${note}` : ""}`,
        `/projects/${projectId}`
      );
    }

    const [row] = await query<DbRow[]>(
      `SELECT approval_status, decided_by, decided_at, decision_note
         FROM projects WHERE id = ?`,
      [projectId]
    );
    return json({ ok: true, decision, project: { id: projectId, ...row } });
  } catch (err) {
    return errorResponse(err);
  }
}
