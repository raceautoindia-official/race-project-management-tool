import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict, forbidden } from "@/lib/http";
import { findProject } from "@/lib/rbac";
import { projectDecisionSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { canDecideProject } from "@/lib/workflow";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/projects/:id/decision { decision: approve|reject, note?, leadId?, memberIds? }
 * The nominated lead (project owner) or an admin approves or rejects a pending
 * project request. Approval unlocks the project; rejection keeps it read-only.
 *
 * An admin approving it may name the project's lead (leadId — anyone active;
 * they become its owner, and the lead nominated on the request becomes an
 * ordinary member) and add members (memberIds) in the same step.
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

    const { decision, note, leadId, memberIds } = projectDecisionSchema.parse(
      await req.json().catch(() => ({}))
    );
    const isAdmin = user.role === "admin";
    const staffing = decision === "approve" && (leadId != null || (memberIds?.length ?? 0) > 0);
    if (staffing && !isAdmin) throw forbidden("Only an admin can set the lead and members while approving");
    const newLead = decision === "approve" && isAdmin && leadId ? leadId : null;
    const extra = decision === "approve" && isAdmin ? [...new Set(memberIds ?? [])] : [];
    const named = [...new Set([...(newLead ? [newLead] : []), ...extra])];
    if (named.length) {
      const active = await query<DbRow[]>(
        `SELECT id FROM users WHERE is_active = 1 AND id IN (${named.map(() => "?").join(",")})`,
        named
      );
      if (active.length !== named.length) throw new ApiError(400, "Someone you chose isn't an active member of staff");
    }

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

    // The admin's staffing choices, now that the approval is theirs.
    const oldOwner = (project.owner_id as number | null) ?? null;
    if (newLead && newLead !== oldOwner) {
      await query(`UPDATE projects SET owner_id = ? WHERE id = ?`, [newLead, projectId]);
      if (oldOwner) {
        await query(`UPDATE project_members SET role_in_project = 'member' WHERE project_id = ? AND user_id = ?`, [projectId, oldOwner]);
      }
    }
    if (newLead) {
      await query(
        `INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'lead')
         ON DUPLICATE KEY UPDATE role_in_project = 'lead'`,
        [projectId, newLead]
      );
      if (newLead !== user.id && newLead !== oldOwner) {
        await notify(newLead, "project_lead_assigned", `You are the lead of "${project.name}" — ${user.name} approved it`, `/projects/${projectId}`);
      }
    }
    for (const id of extra) {
      if (id === (newLead ?? oldOwner)) continue;
      const added = (await query<DbResult>(
        `INSERT IGNORE INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'member')`,
        [projectId, id]
      )) as unknown as DbResult;
      if (added.affectedRows && id !== user.id) {
        await notify(id, "project_member_added", `You were added to the project "${project.name}"`, `/projects/${projectId}`);
      }
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
      `SELECT p.approval_status, p.decided_by, p.decided_at, p.decision_note, p.owner_id, o.name AS owner_name
         FROM projects p LEFT JOIN users o ON o.id = p.owner_id WHERE p.id = ?`,
      [projectId]
    );
    return json({ ok: true, decision, project: { id: projectId, ...row } });
  } catch (err) {
    return errorResponse(err);
  }
}
