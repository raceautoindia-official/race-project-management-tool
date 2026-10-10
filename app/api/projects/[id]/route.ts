import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict, forbidden } from "@/lib/http";
import {
  assertProjectAccess,
  assertProjectManage,
  completionBlockers,
  findProject,
} from "@/lib/rbac";
import { updateProjectSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { projectLockReason } from "@/lib/workflow";
import type { ProjectStatus, RequestStatus } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

async function projectDetail(projectId: number) {
  const rows = await query<DbRow[]>(
    `SELECT p.id, p.name, p.description, p.status, p.approval_status, p.owner_id,
            p.requested_by, p.requested_at, p.decided_by, p.decided_at, p.decision_note,
            p.created_at, p.updated_at, u.name AS owner_name,
            rq.name AS requester_name, dc.name AS decider_name
     FROM projects p
     LEFT JOIN users u ON u.id = p.owner_id
     LEFT JOIN users rq ON rq.id = p.requested_by
     LEFT JOIN users dc ON dc.id = p.decided_by
     WHERE p.id = ? LIMIT 1`,
    [projectId]
  );
  const project = rows[0];

  const members = await query<DbRow[]>(
    `SELECT pm.id, pm.project_id, pm.user_id, pm.role_in_project, u.name, u.email
     FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ?
     ORDER BY (pm.role_in_project = 'lead') DESC, u.name ASC`,
    [projectId]
  );

  const summaryRows = await query<DbRow[]>(
    `SELECT status, COUNT(*) AS c FROM tasks WHERE project_id = ? GROUP BY status`,
    [projectId]
  );
  const taskSummary = { todo: 0, in_progress: 0, review: 0, done: 0, total: 0 };
  for (const r of summaryRows) {
    const key = r.status as keyof typeof taskSummary;
    taskSummary[key] = Number(r.c);
    taskSummary.total += Number(r.c);
  }

  return { project, members, taskSummary };
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const { projectRole } = await assertProjectAccess(user, projectId);
    const detail = await projectDetail(projectId);

    return json({
      ...detail,
      myRole: projectRole,
      canManage: user.role === "admin" || projectRole === "lead",
      readOnlyReason: projectLockReason({
        status: detail.project.status as ProjectStatus,
        approval_status: detail.project.approval_status as RequestStatus,
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const project = await assertProjectManage(user, projectId);
    const body = await req.json().catch(() => ({}));
    const data = updateProjectSchema.parse(body);

    // Pending/rejected requests are decided via /decision, never edited.
    if (project.approval_status !== "approved") {
      throw conflict(
        projectLockReason({
          status: project.status as ProjectStatus,
          approval_status: project.approval_status as RequestStatus,
        }) ?? "This project is read-only."
      );
    }
    // A completed project is read-only; only an admin may reopen it.
    const reopening =
      project.status === "completed" &&
      data.status !== undefined &&
      data.status !== "completed";
    if (project.status === "completed" && !reopening) {
      throw conflict("This project is completed and read-only.");
    }
    if (reopening && user.role !== "admin") {
      throw forbidden("Only an admin can reopen a completed project");
    }
    // Completing requires every task signed off and no open task requests.
    const completing = data.status === "completed" && project.status !== "completed";
    if (completing) {
      const blockers = await completionBlockers(projectId);
      if (blockers.length) {
        throw conflict(`The project can't be completed yet: ${blockers.join("; ")}.`);
      }
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    if (data.name !== undefined) {
      sets.push("name = ?");
      values.push(data.name);
    }
    if (data.description !== undefined) {
      sets.push("description = ?");
      values.push(data.description ?? null);
    }
    if (data.status !== undefined) {
      sets.push("status = ?");
      values.push(data.status);
    }
    if (data.ownerId !== undefined && data.ownerId !== null) {
      sets.push("owner_id = ?");
      values.push(data.ownerId);
    }
    if (sets.length > 0) {
      values.push(projectId);
      // When completing, the blockers are re-checked in the same statement so a
      // task or request added after the check above can't slip through.
      const guard = completing
        ? ` AND NOT EXISTS (SELECT 1 FROM tasks WHERE project_id = ? AND signed_off_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM task_requests WHERE project_id = ? AND status = 'pending')`
        : "";
      if (completing) values.push(projectId, projectId);
      const res = (await query<DbResult>(
        `UPDATE projects SET ${sets.join(", ")} WHERE id = ?${guard}`,
        values
      )) as unknown as DbResult;
      if (completing && res.affectedRows === 0) {
        const blockers = await completionBlockers(projectId);
        throw conflict(
          `The project can't be completed yet: ${blockers.join("; ") || "it changed — reload and try again"}.`
        );
      }
    }

    const statusChanged = data.status !== undefined && data.status !== project.status;
    await logActivity({
      userId: user.id,
      action:
        statusChanged && data.status === "completed"
          ? "project.completed"
          : reopening
            ? "project.reopened"
            : "project.updated",
      entityType: "project",
      entityId: projectId,
      metadata: data as Record<string, unknown>,
    });

    const detail = await projectDetail(projectId);
    return json(detail);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE — an admin may delete any project; the requester may withdraw their
 * own project request while it is pending or after it was rejected.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const project = await findProject(projectId);
    if (!project) throw new ApiError(404, "Project not found");

    const withdrawing =
      project.approval_status !== "approved" && project.requested_by === user.id;
    if (user.role !== "admin" && !withdrawing) {
      throw forbidden("Only an admin can delete a project");
    }

    await query(`DELETE FROM projects WHERE id = ?`, [projectId]);

    await logActivity({
      userId: user.id,
      action: withdrawing && user.role !== "admin" ? "project.request_withdrawn" : "project.deleted",
      entityType: "project",
      entityId: projectId,
      metadata: { name: project.name },
    });

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
