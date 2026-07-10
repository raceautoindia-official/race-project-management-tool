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
