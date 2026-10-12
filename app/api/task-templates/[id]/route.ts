import { query, DbRow } from "@/lib/db";
import { json, errorResponse, ApiError } from "@/lib/http";
import { requireAdmin } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * DELETE — remove a task template.
 *
 * Anyone may add to the shelf; only an admin takes something off it. A
 * template others have started reaching for is not one person's to withdraw,
 * and there is no undo.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdmin();
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new ApiError(400, "Invalid id");

    const [row] = await query<DbRow[]>(
      `SELECT id, name FROM task_templates WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!row) throw new ApiError(404, "Template not found");

    await query(`DELETE FROM task_templates WHERE id = ?`, [id]);
    await logActivity({
      userId: admin.id,
      action: "task_template.deleted",
      entityType: "template",
      entityId: id,
      metadata: { name: row.name },
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
