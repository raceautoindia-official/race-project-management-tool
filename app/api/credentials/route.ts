import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { logActivity } from "@/lib/activity";
import { encryptSecret, secretsConfigured, secretsProblem } from "@/lib/secrets";
import { credentialSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * The admin credentials vault — website logins the team shares.
 *
 * Admin only, at every level: the page, these routes and the reveal. A
 * listing never includes a password; reading one is a separate, deliberate
 * request that gets recorded.
 */
export async function GET() {
  try {
    await requireAdmin();
    const rows = await query<DbRow[]>(
      `SELECT c.id, c.name, c.url, c.username, c.project_id, c.updated_at,
              p.name AS project_name, u.name AS updated_by_name,
              (SELECT COUNT(*) FROM credential_views v WHERE v.credential_id = c.id) AS views,
              (SELECT MAX(v.viewed_at) FROM credential_views v WHERE v.credential_id = c.id) AS last_viewed
         FROM credentials c
         LEFT JOIN projects p ON p.id = c.project_id
         LEFT JOIN users u ON u.id = c.updated_by
        ORDER BY c.name`
    );
    return json({
      // Never the password, and never the notes: both are secrets, and a
      // list is seen far more often than it is needed.
      credentials: rows,
      configured: secretsConfigured(),
      problem: secretsProblem(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST — store a new login. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin();
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

    const result = (await query<DbResult>(
      `INSERT INTO credentials
         (name, url, username, password_cipher, notes_cipher, project_id, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.url ?? null,
        data.username ?? null,
        encryptSecret(data.password),
        data.notes ? encryptSecret(data.notes) : null,
        data.projectId ?? null,
        user.id,
        user.id,
      ]
    )) as unknown as DbResult;

    // The name only. An activity log is read by more people than the vault.
    await logActivity({
      userId: user.id,
      action: "credential.created",
      entityType: "credential",
      entityId: result.insertId,
      metadata: { name: data.name },
    });

    return json({ id: result.insertId }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
