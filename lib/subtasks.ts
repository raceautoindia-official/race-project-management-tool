import { query, DbRow, DbResult } from "./db";
import { conflict, forbidden, notFound } from "./http";
import { assertProjectAccess } from "./rbac";
import { logActivity, notify } from "./activity";
import { projectAlertRecipients } from "./recipients";
import { sendEmail, emailLayout, appBaseUrl, escapeHtml } from "./mailer";
import { can, CANNOT, isManager, type SpineAction, type SpineContext } from "./permissions";
import {
  effectiveWeights,
  makeRoom,
  taskStatusAfterSubtaskChange,
  type SubtaskStatus,
  type TaskStatus,
} from "./work-engine";
import type { User } from "./types";

/**
 * lib/subtasks.ts — loading subtasks with everything the screens show, the
 * permission context for acting on them, and what happens to the task when
 * one changes. The rules themselves live in lib/work-engine.ts and
 * lib/permissions.ts; this file is the database side.
 */

export const SUBTASK_SELECT = `
  s.id, s.task_id, s.title, s.description, s.source, s.assignee_id, s.status, s.is_done,
  s.position, s.start_date, s.due_date, s.weight, s.weight_mode, s.submitted_at,
  s.approved_by, s.approved_at, s.changes_requested, s.created_by, s.created_at,
  u.name AS assignee_name, u.department AS assignee_department,
  u.designation AS assignee_designation, ab.name AS approver_name,
  (SELECT COUNT(*) FROM task_comments c WHERE c.subtask_id = s.id) AS comment_count,
  (SELECT COUNT(*) FROM task_attachments f WHERE f.subtask_id = s.id) AS attachment_count`;

export const SUBTASK_JOINS = `
  LEFT JOIN users u ON u.id = s.assignee_id
  LEFT JOIN users ab ON ab.id = s.approved_by`;

/** A subtask as the API returns it (effective weight filled in by the list). */
export function mapSubtask(r: DbRow, effective?: number) {
  return {
    id: r.id as number,
    task_id: r.task_id as number,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    assignee_id: (r.assignee_id as number | null) ?? null,
    assignee_name: (r.assignee_name as string | null) ?? null,
    assignee_department: (r.assignee_department as string | null) ?? null,
    assignee_designation: (r.assignee_designation as string | null) ?? null,
    status: r.status as SubtaskStatus,
    is_done: Boolean(r.is_done),
    position: Number(r.position),
    start_date: (r.start_date as string | null) ?? null,
    due_date: (r.due_date as string | null) ?? null,
    weight: Number(r.weight),
    weight_mode: r.weight_mode as "auto" | "manual",
    effective_weight: effective ?? null,
    submitted_at: (r.submitted_at as string | null) ?? null,
    approved_by: (r.approved_by as number | null) ?? null,
    approver_name: (r.approver_name as string | null) ?? null,
    approved_at: (r.approved_at as string | null) ?? null,
    changes_requested: (r.changes_requested as string | null) ?? null,
    comment_count: Number(r.comment_count ?? 0),
    attachment_count: Number(r.attachment_count ?? 0),
  };
}

export type SubtaskDto = ReturnType<typeof mapSubtask>;

/** A task's subtasks in order, each with its effective share of the task. */
export async function listSubtasks(taskId: number): Promise<SubtaskDto[]> {
  const rows = await query<DbRow[]>(
    `SELECT ${SUBTASK_SELECT} FROM subtasks s ${SUBTASK_JOINS}
      WHERE s.task_id = ? ORDER BY s.position ASC, s.id ASC`,
    [taskId]
  );
  const weights = effectiveWeights(
    rows.map((r) => ({ id: r.id, weight: r.weight, weight_mode: r.weight_mode, cancelled: r.status === "cancelled" }))
  );
  return rows.map((r) => mapSubtask(r, weights.get(r.id) ?? 0));
}

export interface TaskRef {
  id: number;
  project_id: number;
  title: string;
  status: TaskStatus;
  assignee_id: number | null;
}

/** The task, its project and the caller's place in it, ready for `can()`. */
export async function loadTaskContext(
  user: User,
  taskId: number
): Promise<{ task: TaskRef; project: DbRow; ctx: SpineContext }> {
  const rows = await query<DbRow[]>(
    `SELECT id, project_id, title, status, assignee_id FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  if (!rows.length) throw notFound("Task not found");
  const task = rows[0] as unknown as TaskRef;
  const { project, projectRole } = await assertProjectAccess(user, task.project_id);
  return {
    task,
    project,
    ctx: {
      userId: user.id,
      isAdmin: user.role === "admin",
      projectRole,
      projectOwnerId: (project.owner_id as number | null) ?? null,
      taskOwnerId: task.assignee_id,
    },
  };
}

/** The subtask plus its task context (subtaskAssigneeId filled in). */
export async function loadSubtaskContext(user: User, subtaskId: number) {
  const rows = await query<DbRow[]>(
    `SELECT ${SUBTASK_SELECT} FROM subtasks s ${SUBTASK_JOINS} WHERE s.id = ? LIMIT 1`,
    [subtaskId]
  );
  if (!rows.length) throw notFound("Subtask not found");
  const sub = rows[0];
  const { task, project, ctx } = await loadTaskContext(user, sub.task_id);
  return { sub, task, project, ctx: { ...ctx, subtaskAssigneeId: (sub.assignee_id as number | null) ?? null } };
}

export function assertCan(action: SpineAction, ctx: SpineContext): void {
  if (!can(action, ctx)) throw forbidden(CANNOT[action]);
}

/**
 * New or reopened work on an approved (Done) task reopens the task. Only a
 * manager may do that — the same people who may move a task out of Done.
 */
export function assertMayReopenTask(task: TaskRef, ctx: SpineContext): void {
  if (task.status === "done" && !isManager(ctx)) {
    throw conflict("This task is already approved — ask the project owner or a lead to reopen it before adding work");
  }
}

/** Must `userId` be on the project to be given work in it? Yes. */
export async function assertProjectMember(projectId: number, userId: number): Promise<void> {
  const rows = await query<DbRow[]>(
    `SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1`,
    [projectId, userId]
  );
  if (!rows.length) throw forbidden("That person isn't on this project — add them to the team first");
}

/**
 * Before adding a subtask: if every live subtask has a fixed weight, shrink
 * them so the newcomer gets an even share instead of 0%.
 */
export async function makeRoomForSubtask(taskId: number): Promise<void> {
  const rows = await query<DbRow[]>(
    `SELECT id, weight, weight_mode, status FROM subtasks WHERE task_id = ?`,
    [taskId]
  );
  const room = makeRoom(rows.map((r) => ({ id: r.id, weight: r.weight, weight_mode: r.weight_mode, cancelled: r.status === "cancelled" })));
  for (const [id, weight] of room) await query(`UPDATE subtasks SET weight = ? WHERE id = ?`, [weight, id]);
}

/** The same for a project's tasks, before adding a task. */
export async function makeRoomForTask(projectId: number): Promise<void> {
  const rows = await query<DbRow[]>(
    `SELECT id, weight, weight_mode FROM tasks WHERE project_id = ?`,
    [projectId]
  );
  const room = makeRoom(rows.map((r) => ({ id: r.id, weight: r.weight, weight_mode: r.weight_mode })));
  for (const [id, weight] of room) {
    await query(`UPDATE tasks SET updated_at = updated_at, weight = ? WHERE id = ?`, [weight, id]);
  }
}

/** Where a subtask's notifications point: its task, opened. */
export function subtaskLink(projectId: number, taskId: number, subtaskId?: number): string {
  return `/projects/${projectId}?task=${taskId}${subtaskId ? `&subtask=${subtaskId}` : ""}`;
}

/**
 * After a subtask changed, move its task along if the rules say so
 * (lib/work-engine.ts taskStatusAfterSubtaskChange):
 * - every subtask approved → the task goes to review, and the project's
 *   managers are told (exactly like the owner pressing "Send for review");
 * - new or reopened work on a task in review / Done → back to In progress
 *   (a Done task loses its completion stamp, as a manual reopen does);
 * - the first subtask started → the task starts.
 * A signed-off task never moves: its subtasks are locked before this runs.
 */
export async function syncTaskAfterSubtaskChange(taskId: number, actor: User): Promise<TaskStatus | null> {
  const [task] = await query<DbRow[]>(
    `SELECT id, project_id, title, status, assignee_id, signed_off_at FROM tasks WHERE id = ? LIMIT 1`,
    [taskId]
  );
  if (!task || task.signed_off_at) return null;
  const subs = await query<DbRow[]>(`SELECT status FROM subtasks WHERE task_id = ?`, [taskId]);
  const next = taskStatusAfterSubtaskChange(
    task.status as TaskStatus,
    subs.map((s) => ({ status: s.status as SubtaskStatus }))
  );
  if (!next) return null;

  const extra =
    task.status === "done" ? ", completed_at = NULL, approval_status = 'none'" : "";
  const res = (await query<DbResult>(
    `UPDATE tasks SET status = ?${extra} WHERE id = ? AND status = ? AND signed_off_at IS NULL`,
    [next, taskId, task.status]
  )) as unknown as DbResult;
  if (res.affectedRows === 0) return null;

  await logActivity({
    userId: actor.id,
    action: "task.status_changed",
    entityType: "task",
    entityId: taskId,
    metadata: { from: task.status, to: next, automatic: true, reason: "subtasks" },
  });

  const link = `/projects/${task.project_id}?task=${taskId}`;
  if (next === "review") {
    // Same audience and wording as a manual "Send for review".
    const recipients = await projectAlertRecipients(task.project_id);
    for (const r of recipients.filter((x) => x.id !== actor.id)) {
      await notify(r.id, "review_requested", `All subtasks of "${task.title}" are approved — it is ready for your review`, link);
      if (r.email) {
        await sendEmail({
          to: [r.email],
          subject: `Ready for review: ${task.title}`,
          html: emailLayout(
            "Task ready for review",
            `<p>Every subtask of <strong>${escapeHtml(String(task.title))}</strong> has been approved by its owner, so the task is waiting for your review.</p>
             <p><a href="${appBaseUrl()}${link}">Open the task →</a></p>`
          ),
        });
      }
    }
  } else if (task.status === "done" || task.status === "review") {
    if (task.assignee_id && task.assignee_id !== actor.id) {
      await notify(task.assignee_id, "task_reopened", `"${task.title}" has open subtasks again and is back in progress`, link);
    }
  }
  return next as TaskStatus;
}
