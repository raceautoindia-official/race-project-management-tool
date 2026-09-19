import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import {
  assertProjectAccess,
  assertProjectWritable,
  canManageProject,
} from "@/lib/rbac";
import { forbidden } from "@/lib/http";
import { createTaskSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { fetchTasks, syncTaskLabels } from "@/lib/tasks";
import { normalizeSpec, SPEC_KEYS, specFromBody } from "@/lib/workflow";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    await assertProjectAccess(user, projectId);

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? "";
    const priority = searchParams.get("priority") ?? "";
    const assignee = searchParams.get("assignee") ?? "";

    const where = ["t.project_id = ?"];
    const queryParams: unknown[] = [projectId];
    if (["todo", "in_progress", "review", "done"].includes(status)) {
      where.push("t.status = ?");
      queryParams.push(status);
    }
    if (["low", "medium", "high", "urgent"].includes(priority)) {
      where.push("t.priority = ?");
      queryParams.push(priority);
    }
    if (assignee && Number.isInteger(Number(assignee))) {
      where.push("t.assignee_id = ?");
      queryParams.push(Number(assignee));
    }

    const tasks = await fetchTasks(where.join(" AND "), queryParams);
    return json({ tasks });
  } catch (err) {
    return errorResponse(err);
  }
}

async function isProjectMember(projectId: number, userId: number): Promise<boolean> {
  const m = await query<DbRow[]>(
    `SELECT id FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`,
    [projectId, userId]
  );
  return m.length > 0;
}

/**
 * POST — an admin/lead creates a task directly. It must be an existing-work
 * correction or a new feature (with that type's required fields), name who
 * requested it and an assigned owner; the creator is recorded as approver.
 * Members raise tasks via /requests instead.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");

    const { project, projectRole } = await assertProjectAccess(user, projectId);
    if (!canManageProject(user, projectRole)) {
      throw forbidden(
        "Only an admin or project lead can create tasks — raise a request instead"
      );
    }
    assertProjectWritable(project);
    const body = await req.json().catch(() => ({}));
    const data = createTaskSchema.parse(body);

    if (!(await isProjectMember(projectId, data.assigneeId))) {
      throw new ApiError(400, "Assignee must be a member of the project");
    }
    const requestedBy = data.requestedById ?? user.id;
    if (requestedBy !== user.id && !(await isProjectMember(projectId, requestedBy))) {
      throw new ApiError(400, "The requester must be a member of the project");
    }

    // #7 — follow-up work: a parent must belong to the same project. Any task
    // linked to a parent (or explicitly flagged) is marked additional.
    if (data.parentTaskId) {
      const p = await query<DbRow[]>(
        `SELECT id FROM tasks WHERE id = ? AND project_id = ? LIMIT 1`,
        [data.parentTaskId, projectId]
      );
      if (!p.length) {
        throw new ApiError(400, "Parent task must be in the same project");
      }
    }
    const isAdditional = data.parentTaskId != null || data.isAdditional === true;
    const spec = normalizeSpec(data.taskType, specFromBody(data));

    const result = (await query<DbResult>(
      `INSERT INTO tasks
         (project_id, title, description, task_type, ${SPEC_KEYS.join(", ")},
          status, priority, estimated_hours, assignee_id, created_by, due_date,
          start_date, is_additional, parent_task_id,
          requested_by, request_approved_by, request_approved_at)
       VALUES (?, ?, ?, ?, ${SPEC_KEYS.map(() => "?").join(", ")},
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        projectId,
        data.title,
        data.description ?? null,
        data.taskType,
        ...SPEC_KEYS.map((k) => spec[k]),
        data.status ?? "todo",
        data.priority ?? "medium",
        data.estimatedHours ?? null,
        data.assigneeId,
        user.id,
        data.dueDate ?? null,
        data.startDate ?? null,
        isAdditional ? 1 : 0,
        data.parentTaskId ?? null,
        requestedBy,
        user.id,
      ]
    )) as unknown as DbResult;

    if (data.labelIds && data.labelIds.length > 0) {
      await syncTaskLabels(result.insertId, projectId, data.labelIds);
    }

    await logActivity({
      userId: user.id,
      action: "task.created",
      entityType: "task",
      entityId: result.insertId,
      metadata: { projectId, title: data.title, type: data.taskType },
    });
    if (data.assigneeId !== user.id) {
      await notify(
        data.assigneeId,
        "task_assigned",
        `You were assigned: "${data.title}"`,
        `/projects/${projectId}`
      );
    }

    const [task] = await fetchTasks("t.id = ?", [result.insertId]);
    return json({ task }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
