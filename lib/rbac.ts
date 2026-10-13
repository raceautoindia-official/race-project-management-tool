import { query, DbRow } from "./db";
import { conflict, forbidden, notFound } from "./http";
import {
  projectCompletionBlockers,
  projectLockReason,
  taskLockReason,
} from "./workflow";
import type { ProjectRole, ProjectStatus, RequestStatus, User } from "./types";

/**
 * Is this user a "manager" of the project — i.e. allowed to create/edit/delete
 * tasks, manage members, and change project settings? Admins always are;
 * otherwise only the project lead (head).
 */
export function canManageProject(
  user: User,
  projectRole: ProjectRole | null
): boolean {
  return user.role === "admin" || projectRole === "lead";
}

/** Does this project exist? Returns the row or null. */
export async function findProject(projectId: number): Promise<DbRow | null> {
  const rows = await query<DbRow[]>(
    `SELECT * FROM projects WHERE id = ? LIMIT 1`,
    [projectId]
  );
  return rows[0] ?? null;
}

/** The membership role of a user in a project, or null if not a member. */
export async function getProjectRole(
  userId: number,
  projectId: number
): Promise<ProjectRole | null> {
  const rows = await query<DbRow[]>(
    `SELECT role_in_project FROM project_members
     WHERE project_id = ? AND user_id = ? LIMIT 1`,
    [projectId, userId]
  );
  return (rows[0]?.role_in_project as ProjectRole) ?? null;
}

/**
 * Ensure the user can view/work in a project. Admins always can. Members
 * must belong to it. Throws 404 if the project is missing, 403 if no access.
 * Returns the project row plus the caller's project role (admins: null).
 */
export async function assertProjectAccess(
  user: User,
  projectId: number
): Promise<{ project: DbRow; projectRole: ProjectRole | null }> {
  const project = await findProject(projectId);
  if (!project) throw notFound("Project not found");
  if (user.role === "admin") {
    return { project, projectRole: null };
  }
  const projectRole = await getProjectRole(user.id, projectId);
  if (!projectRole) throw forbidden("You are not a member of this project");
  return { project, projectRole };
}

/**
 * Ensure the user can modify project settings (edit/members). Admins or the
 * project lead. Throws if not allowed.
 */
export async function assertProjectManage(
  user: User,
  projectId: number
): Promise<DbRow> {
  const { project, projectRole } = await assertProjectAccess(user, projectId);
  if (canManageProject(user, projectRole)) return project;
  throw forbidden("Only an admin or project lead can do this");
}

/**
 * Ensure a project accepts changes: approved (not a pending/rejected request)
 * and not completed. Throws 409 with the reason otherwise.
 */
export function assertProjectWritable(project: DbRow): void {
  const reason = projectLockReason({
    status: project.status as ProjectStatus,
    approval_status: project.approval_status as RequestStatus,
  });
  if (reason) throw conflict(reason);
}

/**
 * Ensure a task (and its project) accepts changes: the task is not signed off
 * and the project is writable. Throws 404 if missing, 409 if read-only.
 */
export async function assertTaskWritable(taskId: number): Promise<void> {
  const rows = await query<DbRow[]>(
    `SELECT t.signed_off_at, p.status, p.approval_status
       FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.id = ? LIMIT 1`,
    [taskId]
  );
  const row = rows[0];
  if (!row) throw notFound("Task not found");
  const reason =
    taskLockReason({ signed_off_at: row.signed_off_at }) ??
    projectLockReason({
      status: row.status as ProjectStatus,
      approval_status: row.approval_status as RequestStatus,
    });
  if (reason) throw conflict(reason);
}

/**
 * Deleting these tasks would silently change a signed-off task (its follow-up
 * link or "blocked by" list), so refuse while any signed-off task points at them.
 */
export async function assertNotReferencedBySignedOff(taskIds: number[]): Promise<void> {
  if (taskIds.length === 0) return;
  const ph = taskIds.map(() => "?").join(",");
  const [row] = await query<DbRow[]>(
    `SELECT
       (SELECT COUNT(*) FROM tasks
         WHERE parent_task_id IN (${ph}) AND signed_off_at IS NOT NULL)
     + (SELECT COUNT(*) FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
         WHERE d.depends_on_task_id IN (${ph}) AND t.signed_off_at IS NOT NULL) AS n`,
    [...taskIds, ...taskIds]
  );
  if (Number(row.n) > 0) {
    throw conflict(
      "A signed-off task is a follow-up of, or was blocked by, this task — it can't be deleted."
    );
  }
}

/** Why the project can't be marked Completed yet (empty = it can). */
export async function completionBlockers(projectId: number): Promise<string[]> {
  const [counts] = await query<DbRow[]>(
    `SELECT
       (SELECT COUNT(*) FROM tasks
         WHERE project_id = ? AND signed_off_at IS NULL) AS unsigned_tasks,
       (SELECT COUNT(*) FROM task_requests
         WHERE project_id = ? AND status = 'pending') AS pending_requests`,
    [projectId, projectId]
  );
  return projectCompletionBlockers({
    unsignedTasks: Number(counts.unsigned_tasks),
    pendingRequests: Number(counts.pending_requests),
  });
}

/**
 * Ensure the user may modify a specific task's execution state (status,
 * logged hours, checklist). Managers (admin/lead) may edit any task in the
 * project; a plain member may edit ONLY a task assigned to them. Returns
 * whether the caller is a manager so routes can widen what fields are allowed.
 */
export async function assertTaskEdit(
  user: User,
  task: { project_id: number; assignee_id: number | null }
): Promise<{ manager: boolean }> {
  const { projectRole } = await assertProjectAccess(user, task.project_id);
  if (canManageProject(user, projectRole)) return { manager: true };
  if (task.assignee_id === user.id) return { manager: false };
  throw forbidden(
    "Only an admin, the project lead, or the task's assignee can change this task"
  );
}
