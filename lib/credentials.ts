import "server-only";
import { query, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";

/**
 * Who can see a stored login.
 *
 * Anyone can keep logins here; whoever saved one says who else it is for:
 *   admins   — nobody but them and the administrators
 *   project  — everyone on the project it belongs to
 *   people   — the people named on it
 *
 * Two things are always true on top of that: you can see what you saved, and
 * an administrator can see everything. The second is the point of a company
 * store rather than a private one — somebody has to be able to get at the
 * hosting login when the person who saved it is on leave.
 *
 * The rule lives here, in SQL, so the list and the reveal cannot drift apart:
 * a credential that does not appear in your list cannot be revealed to you.
 */
export const VISIBILITY_SQL = `(
  c.created_by = ?
  OR ? = 'admin'
  OR (c.visibility = 'project' AND c.project_id IN (
        SELECT project_id FROM project_members WHERE user_id = ?
      ))
  OR (c.visibility = 'people' AND c.id IN (
        SELECT credential_id FROM credential_access WHERE user_id = ?
      ))
)`;

export function visibilityParams(user: User): [number, string, number, number] {
  return [user.id, user.role, user.id, user.id];
}

/** Changing or deleting one is for whoever saved it, or an administrator. */
export function canManageCredential(
  user: User,
  credential: { created_by?: number | null }
): boolean {
  return user.role === "admin" || credential.created_by === user.id;
}

/** The logins this person may see, without any of the secrets in them. */
export async function listCredentials(user: User): Promise<DbRow[]> {
  return query<DbRow[]>(
    `SELECT c.id, c.name, c.url, c.username, c.project_id, c.visibility, c.updated_at,
            c.created_by, (c.fields_cipher IS NOT NULL) AS has_fields,
            p.name AS project_name, u.name AS updated_by_name,
            o.name AS owner_name,
            (SELECT COUNT(*) FROM credential_views v WHERE v.credential_id = c.id) AS views,
            (SELECT MAX(v.viewed_at) FROM credential_views v WHERE v.credential_id = c.id) AS last_viewed,
            (SELECT GROUP_CONCAT(au.name ORDER BY au.name SEPARATOR ', ')
               FROM credential_access a JOIN users au ON au.id = a.user_id
              WHERE a.credential_id = c.id) AS shared_with
       FROM credentials c
       LEFT JOIN projects p ON p.id = c.project_id
       LEFT JOIN users u ON u.id = c.updated_by
       LEFT JOIN users o ON o.id = c.created_by
      WHERE ${VISIBILITY_SQL}
      ORDER BY c.name`,
    visibilityParams(user)
  );
}

/** One login, if this person may see it — otherwise nothing. */
export async function findVisibleCredential(
  user: User,
  credentialId: number
): Promise<DbRow | null> {
  const rows = await query<DbRow[]>(
    `SELECT c.id, c.name, c.username, c.password_cipher, c.notes_cipher,
            c.fields_cipher, c.created_by
       FROM credentials c
      WHERE c.id = ? AND ${VISIBILITY_SQL}
      LIMIT 1`,
    [credentialId, ...visibilityParams(user)]
  );
  return rows[0] ?? null;
}

/** Replace the named people on a credential (ignoring anyone inactive). */
export async function setCredentialPeople(
  credentialId: number,
  userIds: number[]
): Promise<void> {
  await query(`DELETE FROM credential_access WHERE credential_id = ?`, [credentialId]);
  if (!userIds.length) return;
  const rows = await query<DbRow[]>(
    `SELECT id FROM users WHERE is_active = TRUE AND id IN (${userIds
      .map(() => "?")
      .join(",")})`,
    userIds
  );
  if (!rows.length) return;
  await query(
    `INSERT INTO credential_access (credential_id, user_id) VALUES ${rows
      .map(() => "(?, ?)")
      .join(", ")}`,
    rows.flatMap((r) => [credentialId, r.id])
  );
}
