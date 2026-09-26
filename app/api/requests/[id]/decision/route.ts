import { NextRequest } from "next/server";
import { pool, query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict, forbidden } from "@/lib/http";
import { assertProjectManage, assertProjectWritable } from "@/lib/rbac";
import { taskRequestDecisionSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import { fetchTaskRequests, fetchTasks } from "@/lib/tasks";
import { checklistFromSpec, SPEC_KEYS } from "@/lib/workflow";
import type { SpecColumns, WorkType } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/requests/:id/decision — an admin/project lead decides a raised
 * task request.
 *   approve { assigneeId, note? }
 *     → creates the task (requested by the raiser, approved by the decider,
 *       owned by the assignee) and links it to the request. Its priority,
 *       effort and dates come from the request: the approver decides who
 *       does the work, not how urgent someone else's need is.
 *   reject { note }  → the request is closed with the reason.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const requestId = Number(id);
    if (!Number.isInteger(requestId)) throw new ApiError(400, "Invalid id");

    const [existing] = await query<DbRow[]>(
      `SELECT project_id, requested_by FROM task_requests WHERE id = ? LIMIT 1`,
      [requestId]
    );
    if (!existing) throw new ApiError(404, "Request not found");
    const project = await assertProjectManage(user, existing.project_id);
    if (existing.requested_by === user.id && user.role !== "admin") {
      throw forbidden("You can't approve or reject your own request — another lead or an admin must");
    }
    assertProjectWritable(project);

    const data = taskRequestDecisionSchema.parse(await req.json().catch(() => ({})));
    const projectId = existing.project_id as number;

    if (data.decision === "approve") {
      const m = await query<DbRow[]>(
        `SELECT id FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`,
        [projectId, data.assigneeId]
      );
      if (!m.length) throw new ApiError(400, "Assignee must be a member of the project");
    }

    let taskId: number | null = null;
    const conn = await pool.getConnection();
    let request: DbRow;
    try {
      await conn.beginTransaction();
      // Serialize with project completion and re-check the project is open.
      const [projectRows] = await conn.execute(
        `SELECT status, approval_status FROM projects WHERE id = ? FOR UPDATE`,
        [projectId]
      );
      assertProjectWritable((projectRows as DbRow[])[0]);
      // Lock the row so two leads can't both decide it.
      const [rows] = await conn.execute(
        `SELECT * FROM task_requests WHERE id = ? FOR UPDATE`,
        [requestId]
      );
      request = (rows as DbRow[])[0];
      // Withdrawn between the first lookup and this lock.
      if (!request) throw new ApiError(404, "Request not found");
      if (request.status !== "pending") {
        throw conflict("This request has already been decided");
      }

      if (data.decision === "approve") {
        const [res] = await conn.execute(
          `INSERT INTO tasks
             (project_id, title, task_type, ${SPEC_KEYS.join(", ")},
              status, priority, estimated_hours, assignee_id, created_by,
              due_date, start_date, request_id,
              requested_by, request_approved_by, request_approved_at)
           VALUES (?, ?, ?, ${SPEC_KEYS.map(() => "?").join(", ")},
                   'todo', ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
          [
            projectId,
            request.title,
            request.task_type,
            ...SPEC_KEYS.map((k) => request[k] ?? null),
            // The requester said how urgent it is and how long it should
            // take; the approver's job is to approve, so their values are
            // only used where they deliberately changed something.
            request.priority ?? "medium",
            request.estimated_hours ?? null,
            data.assigneeId ?? null,
            user.id,
            request.due_date ?? null,
            request.start_date ?? null,
            requestId,
            request.requested_by ?? null,
            user.id,
          ]
        );
        taskId = (res as DbResult).insertId;

        // The checklist starts as what the request itself said "done" means.
        // Inside the transaction, on the same connection, so a task never
        // exists with half a checklist.
        const items = checklistFromSpec(
          request.task_type as WorkType,
          Object.fromEntries(SPEC_KEYS.map((k) => [k, request[k] ?? null])) as SpecColumns
        );
        if (items.length) {
          await conn.execute(
            `INSERT INTO subtasks (task_id, title, position) VALUES ${items
              .map(() => "(?, ?, ?)")
              .join(", ")}`,
            items.flatMap((title, i) => [taskId, title, i])
          );
        }
      }

      await conn.execute(
        `UPDATE task_requests
            SET status = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(),
                decision_note = ?, task_id = ?
          WHERE id = ?`,
        [
          data.decision === "approve" ? "approved" : "rejected",
          user.id,
          data.note || null,
          taskId,
          requestId,
        ]
      );
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    await logActivity({
      userId: user.id,
      action: data.decision === "approve" ? "task_request.approved" : "task_request.rejected",
      entityType: "project",
      entityId: projectId,
      metadata: { requestId, taskId, title: request.title, note: data.note || null },
    });

    const link = `/projects/${projectId}`;
    if (request.requested_by && request.requested_by !== user.id) {
      await notify(
        request.requested_by,
        data.decision === "approve" ? "task_request_approved" : "task_request_rejected",
        data.decision === "approve"
          ? `Your request "${request.title}" was approved by ${user.name}`
          : `Your request "${request.title}" was rejected: ${data.note}`,
        link
      );
    }
    if (data.decision === "approve" && data.assigneeId && data.assigneeId !== user.id) {
      await notify(data.assigneeId, "task_assigned", `You were assigned: "${request.title}"`, link);
    }

    const [updated] = await fetchTaskRequests("r.id = ?", [requestId]);
    const task = taskId ? (await fetchTasks("t.id = ?", [taskId]))[0] : null;
    return json({ request: updated, task });
  } catch (err) {
    return errorResponse(err);
  }
}
