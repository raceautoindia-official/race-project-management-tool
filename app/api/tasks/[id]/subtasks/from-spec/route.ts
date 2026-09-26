import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertTaskEdit, assertTaskWritable } from "@/lib/rbac";
import { pendingChecklistItems, SPEC_KEYS } from "@/lib/workflow";
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
      `SELECT project_id, assignee_id, task_type, ${SPEC_KEYS.join(", ")}
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
        `INSERT INTO subtasks (task_id, title, position) VALUES ${pending
          .map(() => "(?, ?, ?)")
          .join(", ")}`,
        pending.flatMap((title, i) => [taskId, title, Number(nextPos) + i])
      );
    }

    // The whole list back, so the caller shows exactly what is stored.
    const subtasks = await query<DbRow[]>(
      `SELECT id, task_id, title, is_done, position FROM subtasks
        WHERE task_id = ? ORDER BY position ASC, id ASC`,
      [taskId]
    );
    return json({
      added: pending.length,
      subtasks: subtasks.map((r) => ({
        id: r.id,
        task_id: r.task_id,
        title: r.title,
        is_done: Boolean(r.is_done),
        position: r.position,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
