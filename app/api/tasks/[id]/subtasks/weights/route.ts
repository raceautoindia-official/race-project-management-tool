import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertTaskWritable } from "@/lib/rbac";
import { weightsSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";
import { assertCan, listSubtasks, loadTaskContext } from "@/lib/subtasks";
import { saveWeights } from "@/lib/weights";

type Params = { params: Promise<{ id: string }> };

/**
 * PUT /api/tasks/:id/subtasks/weights — { weights: [{id, weight}] } or
 * { reset: true }. How much each subtask counts toward the task. The task
 * owner, the project owner, a lead or an admin.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const taskId = Number((await params).id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const { ctx } = await loadTaskContext(user, taskId);
    assertCan("subtask.weights", ctx);
    await assertTaskWritable(taskId);

    const body = weightsSchema.parse(await req.json().catch(() => ({})));
    await saveWeights("subtasks", "task_id", taskId, body);
    await logActivity({
      userId: user.id,
      action: "subtask.weights_changed",
      entityType: "task",
      entityId: taskId,
      metadata: "reset" in body ? { reset: true } : { weights: body.weights },
    });
    return json({ subtasks: await listSubtasks(taskId) });
  } catch (err) {
    return errorResponse(err);
  }
}
