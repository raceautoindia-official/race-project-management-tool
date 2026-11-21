import { query, DbRow } from "./db";

export interface Recipient {
  id: number;
  name: string;
  email: string | null;
}

/**
 * The people who should be alerted about a project's tasks: every admin, the
 * project owner, and the project's lead(s). De-duplicated by user id. Used for
 * due-date alerts and outstanding-task approval notifications.
 */
export async function projectAlertRecipients(
  projectId: number
): Promise<Recipient[]> {
  const rows = await query<DbRow[]>(
    `SELECT DISTINCT u.id, u.name, u.email
       FROM users u
      WHERE u.is_active = TRUE
        AND (
          u.role = 'admin'
          OR u.id = (SELECT owner_id FROM projects WHERE id = ?)
          OR u.id IN (
            SELECT user_id FROM project_members
            WHERE project_id = ? AND role_in_project = 'lead'
          )
        )`,
    [projectId, projectId]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.email }));
}

/** Where a notification about a task points: the task's own page. */
export function taskLink(projectId: number, taskId: number): string {
  return `/projects/${projectId}/tasks/${taskId}`;
}

/**
 * A task was just approved (Done): ask whoever can sign it off to do so —
 * the person who requested it, unless that is the task's own owner (who
 * can't sign off their own work); then the project's leads and admins.
 */
export async function askForSignOff(
  task: { id: number; project_id: number; title: string; requested_by?: number | null; assignee_id?: number | null },
  actorId: number
): Promise<void> {
  const { notify } = await import("./activity");
  const requesterCanSign = task.requested_by && task.requested_by !== task.assignee_id;
  const ask = requesterCanSign
    ? [Number(task.requested_by)]
    : (await projectAlertRecipients(task.project_id)).map((r) => r.id);
  for (const uid of new Set(ask)) {
    if (uid === actorId) continue;
    await notify(uid, "signoff_requested", `"${task.title}" is done — please verify and sign off`, taskLink(task.project_id, task.id));
  }
}
