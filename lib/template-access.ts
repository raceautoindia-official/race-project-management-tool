import "server-only";
import { query, DbRow } from "./db";
import { ApiError } from "./http";
import { requireUser } from "./auth";
import type { User } from "./types";

/**
 * Who may make a template for their department.
 *
 * Templates used to be an admin's job, which cannot work when every
 * department is supposed to have its own: an admin does not know what a
 * standard Production job looks like, and the people who do were locked out.
 *
 * So it is admins and project leads — the people who already shape work,
 * and the same tier that may export a team's figures or approve a sign-off.
 * A template is not dangerous: it fills a form in, and whoever uses it can
 * change every field before anything is created.
 */
export async function isTemplateAuthor(user: User): Promise<boolean> {
  if (user.role === "admin") return true;
  const rows = await query<DbRow[]>(
    `SELECT 1 FROM project_members
      WHERE user_id = ? AND role_in_project = 'lead' LIMIT 1`,
    [user.id]
  );
  return rows.length > 0;
}

/** The signed-in user, or 403 if they may not author templates. */
export async function requireTemplateAuthor(): Promise<User> {
  const user = await requireUser();
  if (!(await isTemplateAuthor(user))) {
    throw new ApiError(
      403,
      "Only admins and project leads can save templates for a department."
    );
  }
  return user;
}
