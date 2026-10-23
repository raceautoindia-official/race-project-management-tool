import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { assertProjectAccess, assertProjectWritable } from "@/lib/rbac";
import { weightsSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { can, CANNOT } from "@/lib/permissions";
import { effectiveWeights } from "@/lib/work-engine";
import { saveWeights } from "@/lib/weights";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/projects/:id/tasks/weights — { weights: [{id, weight}] } or
 * { reset: true }. How much each task counts toward the project. The project
 * owner, a lead or an admin. Returns every task's effective weight.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const projectId = Number((await params).id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    const { project, projectRole } = await assertProjectAccess(user, projectId);
    const ctx = { userId: user.id, isAdmin: user.role === "admin", projectRole, projectOwnerId: project.owner_id ?? null };
    if (!can("task.weights", ctx)) throw forbidden(CANNOT["task.weights"]);
    assertProjectWritable(project);

    const body = weightsSchema.parse(await req.json().catch(() => ({})));
    await saveWeights("tasks", "project_id", projectId, body);
    await logActivity({
      userId: user.id,
      action: "project.weights_changed",
      entityType: "project",
      entityId: projectId,
      metadata: "reset" in body ? { reset: true } : { weights: body.weights },
    });

    const rows = await query<DbRow[]>(
      `SELECT id, weight, weight_mode FROM tasks WHERE project_id = ?`,
      [projectId]
    );
    const eff = effectiveWeights(rows.map((r) => ({ id: r.id, weight: r.weight, weight_mode: r.weight_mode })));
    return json({
      tasks: rows.map((r) => ({ id: r.id, weight: Number(r.weight), weight_mode: r.weight_mode, effective_weight: eff.get(r.id) ?? 0 })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
