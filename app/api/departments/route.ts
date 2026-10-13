import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET — the departments actually in use, with how many people and projects
 * are in each.
 *
 * There is no departments table and there should not be one: the list belongs
 * to the Attendance app, which PM reads and never writes. So the answer is
 * whatever departments the mirrored people and the projects name between
 * them — a department with nobody and nothing in it is not a thing anyone
 * needs to filter by.
 */
export async function GET() {
  try {
    await requireUser();
    const rows = await query<DbRow[]>(
      `SELECT d.name,
              (SELECT COUNT(*) FROM users u
                WHERE u.is_active = 1 AND u.department = d.name) AS people,
              (SELECT COUNT(*) FROM projects p
                WHERE p.department = d.name AND p.status <> 'archived') AS projects
         FROM (
           SELECT DISTINCT department AS name FROM users
            WHERE department IS NOT NULL AND department <> ''
           UNION
           SELECT DISTINCT department FROM projects
            WHERE department IS NOT NULL AND department <> ''
         ) d
        ORDER BY d.name`
    );
    return json({ departments: rows });
  } catch (err) {
    return errorResponse(err);
  }
}
