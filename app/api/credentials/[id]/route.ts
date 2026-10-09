import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { logActivity } from "@/lib/activity";
import { encryptSecret, secretsConfigured, secretsProblem } from "@/lib/secrets";
import { credentialUpdateSchema } from "@/lib/validation";
import { canManageCredential, setCredentialPeople } from "@/lib/credentials";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * PATCH — change a stored login. Only the fields sent are touched, and only
 * by whoever saved it or an administrator.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const credentialId = Number(id);
    if (!Number.isInteger(credentialId)) throw new ApiError(400, "Invalid id");

    const [existing] = await query<DbRow[]>(
      `SELECT id, name, project_id, created_by FROM credentials WHERE id = ? LIMIT 1`,
      [credentialId]
    );
    if (!existing) throw new ApiError(404, "Credential not found");
    if (!canManageCredential(user, { created_by: existing.created_by as number | null })) {
      throw forbidden("Only the person who saved this, or an admin, can change it");
    }

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
    if (data.visibility !== undefined) {
      if (data.visibility === "project") {
        // "Everyone on the project" needs a project to mean anything.
        const projectId =
          data.projectId !== undefined ? data.projectId : existing.project_id;
        if (projectId == null) throw new ApiError(400, "Pick the project this login belongs to");
      }
      sets.push("visibility = ?");
      values.push(data.visibility);
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
    // Changing only who it is shared with changes nothing on the row itself.
    const changingPeople = data.visibility === "people" || data.userIds !== undefined;
    if (!sets.length && !changingPeople) throw new ApiError(400, "Nothing to change");

    if (sets.length) {
      sets.push("updated_by = ?");
      values.push(user.id);
      values.push(credentialId);
      await query(`UPDATE credentials SET ${sets.join(", ")} WHERE id = ?`, values);
    }
    if (changingPeople) {
      await setCredentialPeople(credentialId, data.userIds ?? []);
    }

    await logActivity({
      userId: user.id,
      action: "credential.updated",
      entityType: "credential",
      entityId: credentialId,
      metadata: {
        name: data.name ?? existing.name,
        passwordChanged: Boolean(data.password),
        visibility: data.visibility,
      },
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE — remove it. The record of who read it stays. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const credentialId = Number(id);
    if (!Number.isInteger(credentialId)) throw new ApiError(400, "Invalid id");

    const [existing] = await query<DbRow[]>(
      `SELECT id, name, created_by FROM credentials WHERE id = ? LIMIT 1`,
      [credentialId]
    );
    if (!existing) throw new ApiError(404, "Credential not found");
    if (!canManageCredential(user, { created_by: existing.created_by as number | null })) {
      throw forbidden("Only the person who saved this, or an admin, can delete it");
    }

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
