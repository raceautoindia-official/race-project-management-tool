import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { checkRateLimit } from "@/lib/ratelimit";
import { decryptSecret, secretsConfigured, secretsProblem } from "@/lib/secrets";
import { findVisibleCredential } from "@/lib/credentials";

type Params = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * POST /api/credentials/:id/reveal — hand back the password itself.
 *
 * Deliberately not part of the listing: reading a password is an act, and
 * this is where it is recorded. POST rather than GET so it cannot be reached
 * by a link, a prefetch, or anything that follows URLs on a page.
 *
 * Open to whoever the login was shared with — and to nobody else: a login
 * that does not appear in your list cannot be revealed to you, because both
 * ask the same question of the database.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const credentialId = Number(id);
    if (!Number.isInteger(credentialId)) throw new ApiError(400, "Invalid id");

    // Reading one at a time is normal; reading the whole vault in a minute
    // is not, and is the shape of an account someone else is using.
    const limit = checkRateLimit(`credential-reveal:${user.id}`, 30);
    if (!limit.ok) {
      throw new ApiError(429, `Too many at once. Try again in ${limit.retryAfter}s.`);
    }

    if (!secretsConfigured()) {
      throw new ApiError(503, secretsProblem() ?? "Credentials storage is not configured");
    }

    const row = await findVisibleCredential(user, credentialId);
    // Not shared with you reads the same as not there: a 403 would confirm
    // that a login by that id exists.
    if (!row) throw new ApiError(404, "Credential not found");

    let password: string;
    let notes: string | null = null;
    let fields: { label: string; value: string }[] = [];
    try {
      password = decryptSecret(String(row.password_cipher));
      if (row.notes_cipher) notes = decryptSecret(String(row.notes_cipher));
      if (row.fields_cipher) fields = JSON.parse(decryptSecret(String(row.fields_cipher)));
    } catch {
      // A changed key, or a row that has been altered. Say which it looks
      // like rather than returning something that is not the password.
      throw new ApiError(
        500,
        "This could not be decrypted — CREDENTIALS_KEY has changed since it was saved, or the row was altered."
      );
    }

    // Recorded before it is handed over, so a failure to record is a failure
    // to reveal rather than a quiet gap in the trail.
    await query(
      `INSERT INTO credential_views (credential_id, credential_name, user_id, viewed_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP())`,
      [credentialId, row.name, user.id]
    );

    return json({ username: row.username ?? null, password, notes, fields });
  } catch (err) {
    return errorResponse(err);
  }
}
