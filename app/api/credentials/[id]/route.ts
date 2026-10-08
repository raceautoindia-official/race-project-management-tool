import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { logActivity } from "@/lib/activity";
import { encryptSecret, secretsConfigured, secretsProblem } from "@/lib/secrets";
import { credentialUpdateSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/** PATCH — change a stored login. Only the fields sent are touched. */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const credentialId = Number(id);
    if (!Number.isInteger(credentialId)) throw new ApiError(400, "Invalid id");

    const [existing] = await query<DbRow[]>(
      `SELECT id, name FROM credentials WHERE id = ? LIMIT 1`,
      [credentialId]
    );
    if (!existing) throw new ApiError(404, "Credential not found");

    const data = credentialUpdateSchema.parse(await req.json().catch(() => ({})));
    const sets: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      sets.push("name = ?");
      values.push(data.name);
    }
    if (data.url !== undefined) {
      sets.push("url = ?");
      values.push(data.url || null);
    }
    if (data.username !== undefined) {
      sets.push("username = ?");
      values.push(data.username || null);
    }
    if (data.projectId !== undefined) {
      sets.push("project_id = ?");
      values.push(data.projectId ?? null);
    }
    // A blank password means "leave it alone", not "set it to nothing":
    // the form cannot show the current one, so it cannot send it back.
    if (data.password) {
      if (!secretsConfigured()) {
        throw new ApiError(503, secretsProblem() ?? "Credentials storage is not configured");
      }
      sets.push("password_cipher = ?");
      values.push(encryptSecret(data.password));
    }
    if (data.notes !== undefined) {
      if (data.notes && !secretsConfigured()) {
        throw new ApiError(503, secretsProblem() ?? "Credentials storage is not configured");
      }
      sets.push("notes_cipher = ?");
      values.push(data.notes ? encryptSecret(data.notes) : null);
    }
    if (!sets.length) throw new ApiError(400, "Nothing to change");

    sets.push("updated_by = ?");
    values.push(user.id);
    values.push(credentialId);
    await query(`UPDATE credentials SET ${sets.join(", ")} WHERE id = ?`, values);

    await logActivity({
      userId: user.id,
      action: "credential.updated",
      entityType: "credential",
      entityId: credentialId,
      metadata: { name: data.name ?? existing.name, passwordChanged: Boolean(data.password) },
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE — remove it. The record of who read it stays. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAdmin();
    const { id } = await params;
    const credentialId = Number(id);
    if (!Number.isInteger(credentialId)) throw new ApiError(400, "Invalid id");

    const [existing] = await query<DbRow[]>(
      `SELECT id, name FROM credentials WHERE id = ? LIMIT 1`,
      [credentialId]
    );
    if (!existing) throw new ApiError(404, "Credential not found");

    await query(`DELETE FROM credentials WHERE id = ?`, [credentialId]);
    await logActivity({
      userId: user.id,
      action: "credential.deleted",
      entityType: "credential",
      entityId: credentialId,
      metadata: { name: existing.name },
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
