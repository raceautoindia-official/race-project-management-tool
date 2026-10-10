import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { logActivity } from "@/lib/activity";
import { encryptSecret, secretsConfigured, secretsProblem } from "@/lib/secrets";
import { listCredentials, setCredentialPeople } from "@/lib/credentials";
import { credentialSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * The credentials vault — website logins the team shares.
 *
 * Anyone may keep a login here and say who else it is for. Changing or
 * deleting one is for whoever saved it, or an administrator — who can see
 * everything, so that a login does not leave with the person who saved it.
 *
 * A listing never includes a password: reading one is a separate, deliberate
 * request that gets recorded.
 */
export async function GET() {
  try {
    const user = await requireUser();
    return json({
      credentials: await listCredentials(user),
      configured: secretsConfigured(),
      problem: user.role === "admin" ? secretsProblem() : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST — store a new login. Anyone may; it is theirs. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!secretsConfigured()) {
      throw new ApiError(503, secretsProblem() ?? "Credentials storage is not configured");
    }
    const data = credentialSchema.parse(await req.json().catch(() => ({})));

    if (data.projectId != null) {
      const p = await query<DbRow[]>(`SELECT id FROM projects WHERE id = ? LIMIT 1`, [
        data.projectId,
      ]);
      if (!p.length) throw new ApiError(400, "That project does not exist");
    }
    // "Everyone on the project" needs a project to mean anything.
    if (data.visibility === "project" && data.projectId == null) {
      throw new ApiError(400, "Pick the project this login belongs to");
    }

    const result = (await query<DbResult>(
      `INSERT INTO credentials
         (name, url, username, password_cipher, notes_cipher, fields_cipher,
          visibility, project_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.url ?? null,
        data.username,
        encryptSecret(data.password),
        data.notes ? encryptSecret(data.notes) : null,
        // An account number is not a secret on its own; next to the password
        // it is half of one.
        data.fields?.length ? encryptSecret(JSON.stringify(data.fields)) : null,
        data.visibility ?? "admins",
        data.projectId ?? null,
        user.id,
        user.id,
      ]
    )) as unknown as DbResult;

    if (data.visibility === "people") {
      await setCredentialPeople(result.insertId, data.userIds ?? []);
    }

    // The name only. An activity log is read by more people than the vault.
    await logActivity({
      userId: user.id,
      action: "credential.created",
      entityType: "credential",
      entityId: result.insertId,
      metadata: { name: data.name, visibility: data.visibility ?? "admins" },
    });

    return json({ id: result.insertId }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
