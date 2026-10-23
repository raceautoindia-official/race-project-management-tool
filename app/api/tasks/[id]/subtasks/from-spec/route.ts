import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertTaskEdit, assertTaskWritable } from "@/lib/rbac";
import { pendingChecklistItems, SPEC_KEYS } from "@/lib/workflow";
import { listSubtasks, loadTaskContext, syncTaskAfterSubtaskChange } from "@/lib/subtasks";
import { isManager } from "@/lib/permissions";
import type { SpecColumns, WorkType } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/tasks/:id/subtasks/from-spec — append this task's specification
 * (expected behavior + acceptance criteria, or features + rules) to its
 * checklist.
 *
 * New tasks get this at creation. This is for the ones that came before, and
 * for a spec that was written or corrected afterwards. It only ever adds: an
 * item already on the list is left as it is, ticked or not. The items come
 * from the task's own stored spec, never from the request body.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const taskId = Number(id);
    if (!Number.isInteger(taskId)) throw new ApiError(400, "Invalid id");

    const rows = await query<DbRow[]>(
      `SELECT project_id, assignee_id, status, task_type, ${SPEC_KEYS.join(", ")}
         FROM tasks WHERE id = ? LIMIT 1`,
      [taskId]
    );
    if (!rows.length) throw new ApiError(404, "Task not found");
    const task = rows[0];
    await assertTaskEdit(user, {
      project_id: task.project_id,
      assignee_id: task.assignee_id,
    });
    await assertTaskWritable(taskId);
    if (task.status === "done" && user.role !== "admin") {
      // Adding spec points to an approved task would reopen it; a manager decides that.
      const { ctx } = await loadTaskContext(user, taskId);
      if (!isManager(ctx)) {
        throw new ApiError(409, "This task is already approved — ask the project owner or a lead to reopen it before adding work");
      }
    }

    const existing = await query<DbRow[]>(
      `SELECT title FROM subtasks WHERE task_id = ?`,
      [taskId]
    );
    const spec = Object.fromEntries(
      SPEC_KEYS.map((k) => [k, task[k] ?? null])
    ) as SpecColumns;
    const pending = pendingChecklistItems(
      task.task_type as WorkType,
      spec,
      existing.map((r) => String(r.title))
    );

    if (pending.length) {
      const [{ nextPos }] = await query<DbRow[]>(
        `SELECT COALESCE(MAX(position) + 1, 0) AS nextPos FROM subtasks WHERE task_id = ?`,
        [taskId]
      );
      await query(
        `INSERT INTO subtasks (task_id, title, position, source, assignee_id) VALUES ${pending
          .map(() => "(?, ?, ?, ?, ?)")
          .join(", ")}`,
        pending.flatMap((item, i) => [
          taskId,
          item.title,
          Number(nextPos) + i,
          item.source,
          task.assignee_id ?? null,
        ])
      );
    }

    // New open work pulls a task in review back into progress.
    if (pending.length) await syncTaskAfterSubtaskChange(taskId, user);
    // The whole list back, so the caller shows exactly what is stored.
    return json({ added: pending.length, subtasks: await listSubtasks(taskId) });
  } catch (err) {
    return errorResponse(err);
  }
}
