import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertTaskWritable } from "@/lib/rbac";
import { createSubtaskSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import {
  assertCan,
  assertMayReopenTask,
  assertProjectMember,
  listSubtasks,
  loadTaskContext,
  makeRoomForSubtask,
  subtaskLink,
  syncTaskAfterSubtaskChange,
} from "@/lib/subtasks";

type Params = { params: Promise<{ id: string }> };

function taskIdOf(id: string): number {
  const taskId = Number(id);
  if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
  return taskId;
}

/** GET /api/tasks/:id/subtasks — the task's subtasks, with assignees and weights. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const taskId = taskIdOf((await params).id);
    await loadTaskContext(user, taskId); // access check
    return json({ subtasks: await listSubtasks(taskId) });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST /api/tasks/:id/subtasks — split the task: { title, description?,
 * assigneeId?, startDate?, dueDate? }. The task owner, project owner, a lead
 * or an admin. Weights stay an even split (a fully fixed set makes room).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const taskId = taskIdOf((await params).id);
    const { task, ctx } = await loadTaskContext(user, taskId);
    assertCan("subtask.create", ctx);
    assertMayReopenTask(task, ctx);
    await assertTaskWritable(taskId);

    const data = createSubtaskSchema.parse(await req.json().catch(() => ({})));
    // Not given → the task owner does it; explicitly null → nobody yet.
    const assigneeId = data.assigneeId === undefined ? task.assignee_id : data.assigneeId;
    if (assigneeId) await assertProjectMember(task.project_id, assigneeId);

    await makeRoomForSubtask(taskId);
    const [{ nextPos }] = await query<DbRow[]>(
      `SELECT COALESCE(MAX(position) + 1, 0) AS nextPos FROM subtasks WHERE task_id = ?`,
      [taskId]
    );
    const res = (await query<DbResult>(
      `INSERT INTO subtasks (task_id, title, description, assignee_id, position, start_date, due_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [taskId, data.title, data.description ?? null, assigneeId ?? null, nextPos, data.startDate ?? null, data.dueDate ?? null, user.id]
    )) as unknown as DbResult;
    const subtaskId = res.insertId;

    await logActivity({
      userId: user.id,
      action: "subtask.created",
      entityType: "task",
      entityId: taskId,
      metadata: { subtaskId, title: data.title, assigneeId: assigneeId ?? null },
    });
    if (assigneeId && assigneeId !== user.id) {
      await notify(
        assigneeId,
        "subtask_assigned",
        `New subtask for you: "${data.title}" (in "${task.title}")`,
        subtaskLink(task.project_id, taskId, subtaskId)
      );
    }
    // New open work pulls a task in review / Done back into progress.
    await syncTaskAfterSubtaskChange(taskId, user);

    const subtask = (await listSubtasks(taskId)).find((s) => s.id === subtaskId);
    return json({ subtask }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
