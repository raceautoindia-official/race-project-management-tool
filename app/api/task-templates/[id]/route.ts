import { query, DbRow } from "@/lib/db";
import { json, errorResponse, ApiError } from "@/lib/http";
import { requireTemplateAuthor } from "@/lib/template-access";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** DELETE — remove a task template. Its own department, or an admin. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireTemplateAuthor();
    const id = Number((await params).id);
    if (!Number.isInteger(id)) throw new ApiError(400, "Invalid id");

    const [row] = await query<DbRow[]>(
      `SELECT id, name, department, created_by FROM task_templates WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!row) throw new ApiError(404, "Template not found");

    // A lead tidies their own department's shelf, not somebody else's.
    const mine =
      row.created_by === user.id ||
      (user.department != null && row.department === user.department);
    if (user.role !== "admin" && !mine) {
      throw new ApiError(403, "That template belongs to another department.");
    }

    await query(`DELETE FROM task_templates WHERE id = ?`, [id]);
    await logActivity({
      userId: user.id,
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
