import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import {
  assertProjectAccess,
  assertTaskWritable,
  canManageProject,
} from "@/lib/rbac";
import { logActivity, notify } from "@/lib/activity";
import { projectAlertRecipients } from "@/lib/recipients";

type Params = { params: Promise<{ id: string }> };

async function loadTaskRef(taskId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT id, project_id, title FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  if (!rows.length) throw new ApiError(404, "Task not found");
  return rows[0];
}

async function listDependencies(taskId: number) {
  const rows = await query<DbRow[]>(
    `SELECT d.depends_on_task_id AS id, t.title, t.status,
            d.status AS approval, d.reason, d.requested_by,
            u.name AS requester_name
       FROM task_dependencies d
       JOIN tasks t ON t.id = d.depends_on_task_id
       LEFT JOIN users u ON u.id = d.requested_by
      WHERE d.task_id = ?
      ORDER BY d.status ASC, t.title`,
    [taskId]
  );
  return rows.map((d) => ({
    id: d.id as number,
    title: d.title as string,
    status: d.status as string,
    done: d.status === "done",
    approval: d.approval as "pending" | "approved",
    reason: (d.reason as string) ?? null,
    requested_by: (d.requested_by as number) ?? null,
    requester_name: (d.requester_name as string) ?? null,
  }));
}

/**
 * GET — the tasks this task is blocked by, and whether it is currently
 * blocked. A blocker a member has raised but nobody has approved is listed
 * as pending and does not block yet: it is a claim until a lead agrees.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    await assertProjectAccess(user, task.project_id);

    const dependencies = await listDependencies(taskId);
    return json({
      dependencies,
      blocked: dependencies.some((d) => d.approval === "approved" && !d.done),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * POST { dependsOnTaskId, reason? } — say this task is waiting on another.
 *
 * Anyone on the project may raise one: the person who finds out the work is
 * stuck is the person doing it. It waits for a lead's decision. A lead or
 * admin raising one is the decision, so theirs is approved as it is made.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    const { project, projectRole } = await assertProjectAccess(user, task.project_id);
    await assertTaskWritable(taskId);

    const body = await req.json().catch(() => ({}));
    const dependsOn = Number(body.dependsOnTaskId);
    const reason = String(body.reason ?? "").trim().slice(0, 500) || null;
    if (!Number.isInteger(dependsOn)) throw new ApiError(400, "Invalid dependsOnTaskId");
    if (dependsOn === taskId) throw new ApiError(400, "A task cannot depend on itself");

    const other = await query<DbRow[]>(
      `SELECT id, title FROM tasks WHERE id = ? AND project_id = ? LIMIT 1`,
      [dependsOn, task.project_id]
    );
    if (!other.length) throw new ApiError(400, "The blocker must be a task in the same project");

    // Prevent an obvious cycle (the other task already depends on this one).
    const cycle = await query<DbRow[]>(
      `SELECT 1 FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ? LIMIT 1`,
      [dependsOn, taskId]
    );
    if (cycle.length) throw new ApiError(400, "That would create a circular dependency");

    const manager = canManageProject(user, projectRole);
    await query(
      `INSERT INTO task_dependencies
         (task_id, depends_on_task_id, status, reason, requested_by, decided_by, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         reason = COALESCE(VALUES(reason), reason)`,
      [
        taskId,
        dependsOn,
        manager ? "approved" : "pending",
        reason,
        user.id,
        manager ? user.id : null,
        manager ? new Date() : null,
      ]
    );

    await logActivity({
      userId: user.id,
      action: manager ? "task.dependency_added" : "task.blocker_requested",
      entityType: "task",
      entityId: taskId,
      metadata: { dependsOn, reason },
    });

    // The people who can decide it need to know it is waiting for them.
    if (!manager) {
      // To the task itself: the person deciding should land on the thing
      // they were told about, not on the board it sits somewhere on.
      const link = `/projects/${task.project_id}?task=${taskId}`;
      const recipients = await projectAlertRecipients(task.project_id as number);
      for (const r of recipients.filter((r) => r.id !== user.id)) {
        await notify(
          r.id,
          "blocker_requested",
          `${user.name} says "${task.title}" is blocked by "${other[0].title}" in ${project.name} — awaiting approval`,
          link
        );
      }
    }

    return json({ dependencies: await listDependencies(taskId) }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE ?dependsOnTaskId= — a lead removes a blocker, or the person who
 * raised one withdraws it while it is still waiting to be decided.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");
    const task = await loadTaskRef(taskId);
    const { projectRole } = await assertProjectAccess(user, task.project_id);
    await assertTaskWritable(taskId);

    const dependsOn = Number(new URL(req.url).searchParams.get("dependsOnTaskId"));
    if (!Number.isInteger(dependsOn)) throw new ApiError(400, "Invalid dependsOnTaskId");

    const [row] = await query<DbRow[]>(
      `SELECT status, requested_by FROM task_dependencies
        WHERE task_id = ? AND depends_on_task_id = ? LIMIT 1`,
      [taskId, dependsOn]
    );
    if (!row) return json({ dependencies: await listDependencies(taskId) });

    const manager = canManageProject(user, projectRole);
    const ownPending = row.status === "pending" && row.requested_by === user.id;
    if (!manager && !ownPending) {
      throw forbidden(
        "Only a project lead can remove a blocker — you can withdraw one you raised while it is still awaiting approval"
      );
    }

    await query(
      `DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?`,
      [taskId, dependsOn]
    );
    await logActivity({
      userId: user.id,
      action: ownPending && !manager ? "task.blocker_withdrawn" : "task.dependency_removed",
      entityType: "task",
      entityId: taskId,
      metadata: { dependsOn },
    });
    return json({ dependencies: await listDependencies(taskId) });
  } catch (err) {
    return errorResponse(err);
  }
}
