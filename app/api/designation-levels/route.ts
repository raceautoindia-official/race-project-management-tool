import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireAdmin, requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { designationLevelSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

/**
 * Job titles and their seniority level (1 = most junior). People keep their
 * free-text title in users.designation; this list gives each title a level
 * so seniority compares across differently named titles.
 *
 *   GET    — every title with its level and how many people hold it (anyone)
 *   PUT    — { title, level } set or change a title's level (admin)
 *   DELETE — ?id= remove a title from the list; people keep their title (admin)
 */
export async function GET() {
  try {
    await requireUser();
    const rows = await query<DbRow[]>(
      `SELECT d.id, d.title, d.level,
              (SELECT COUNT(*) FROM users u
                WHERE u.is_active = TRUE AND TRIM(u.designation) = d.title) AS people
         FROM designation_levels d
        ORDER BY (d.level IS NULL), d.level, d.title`
    );
    return json({
      levels: rows.map((r) => ({ id: r.id, title: r.title, level: r.level ?? null, people: Number(r.people) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { title, level } = designationLevelSchema.parse(await req.json().catch(() => ({})));
    await query(
      `INSERT INTO designation_levels (title, level) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE level = VALUES(level)`,
      [title, level]
    );
    await logActivity({
      userId: admin.id,
      action: "designation.level_set",
      entityType: "user",
      entityId: null,
      metadata: { title, level },
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!Number.isInteger(id)) throw new ApiError(400, "Invalid id");
    const [row] = await query<DbRow[]>(`SELECT title FROM designation_levels WHERE id = ?`, [id]);
    if (!row) throw new ApiError(404, "Not found");
    await query(`DELETE FROM designation_levels WHERE id = ?`, [id]);
    await logActivity({
      userId: admin.id,
      action: "designation.removed",
      entityType: "user",
      entityId: null,
      metadata: { title: row.title },
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
