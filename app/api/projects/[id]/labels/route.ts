import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess, assertProjectManage } from "@/lib/rbac";
import { createLabelSchema } from "@/lib/validation";
import { LABEL_COLORS } from "@/lib/colors";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectAccess(user, projectId);

    const labels = await query<DbRow[]>(
      `SELECT id, project_id, name, color FROM labels WHERE project_id = ? ORDER BY name`,
      [projectId]
    );
    return json({ labels });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectAccess(user, projectId);

    const body = await req.json().catch(() => ({}));
    const data = createLabelSchema.parse(body);
    const color = LABEL_COLORS.includes(
      (data.color ?? "") as (typeof LABEL_COLORS)[number]
    )
      ? data.color
      : "slate";

    const dup = await query<DbRow[]>(
      `SELECT id FROM labels WHERE project_id = ? AND name = ? LIMIT 1`,
      [projectId, data.name]
    );
    if (dup.length) throw new ApiError(409, "A label with this name already exists");

    const result = (await query<DbResult>(
      `INSERT INTO labels (project_id, name, color) VALUES (?, ?, ?)`,
      [projectId, data.name, color]
    )) as unknown as DbResult;

    return json(
      {
        label: { id: result.insertId, project_id: projectId, name: data.name, color },
      },
      201
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const projectId = Number(id);
    if (!Number.isInteger(projectId)) throw new ApiError(400, "Invalid id");
    await assertProjectManage(user, projectId);

    const labelId = Number(new URL(req.url).searchParams.get("labelId"));
    if (!Number.isInteger(labelId)) throw new ApiError(400, "Invalid labelId");

    await query(`DELETE FROM labels WHERE id = ? AND project_id = ?`, [
      labelId,
      projectId,
    ]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
