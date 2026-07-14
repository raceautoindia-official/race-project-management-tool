import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/templates/:id — admin. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { id } = await params;
    const tId = Number(id);
    if (!Number.isInteger(tId)) throw new ApiError(400, "Invalid id");
    const rows = await query<DbRow[]>(
      `SELECT id FROM project_templates WHERE id = ? LIMIT 1`,
      [tId]
    );
    if (!rows.length) throw new ApiError(404, "Template not found");
    await query(`DELETE FROM project_templates WHERE id = ?`, [tId]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
