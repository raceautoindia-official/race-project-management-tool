import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

/** What people are usually asked for. "Other" covers everything else. */
export const DOCUMENT_CATEGORIES = [
  "id_proof",
  "address_proof",
  "qualification",
  "bank",
  "contract",
  "other",
] as const;

/**
 * Personal documents — what someone uploads about themselves.
 *
 * Theirs: they upload and they remove. An admin may look, because somebody
 * has to be able to, and every look is recorded in the activity log.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    // No ?userId means your own. Number(null) is 0, not NaN, so the absent
    // case has to be checked before it turns into "user zero".
    const raw = new URL(req.url).searchParams.get("userId");
    const asked = raw === null || raw === "" ? null : Number(raw);
    const forUser = asked !== null && Number.isInteger(asked) && asked > 0 ? asked : user.id;
    if (forUser !== user.id && user.role !== "admin") {
      throw forbidden("These are not yours to look at");
    }

    const rows = await query<DbRow[]>(
      `SELECT d.id, d.user_id, d.category, d.note, d.filename, d.mime_type,
              d.size_bytes, d.created_at, u.name AS user_name
         FROM user_documents d JOIN users u ON u.id = d.user_id
        WHERE d.user_id = ?
        ORDER BY d.created_at DESC`,
      [forUser]
    );
    return json({ documents: rows });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST (multipart: file, category, note) — upload one of your own. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof Blob)) {
      throw new ApiError(400, "No file uploaded (form field 'file')");
    }
    if (file.size === 0) throw new ApiError(400, "That file is empty");
    if (file.size > MAX_BYTES) throw new ApiError(400, "File too large (max 10 MB)");

    const asked = String(form?.get("category") ?? "other");
    const category = (DOCUMENT_CATEGORIES as readonly string[]).includes(asked)
      ? asked
      : "other";
    const note = String(form?.get("note") ?? "").trim().slice(0, 255) || null;
    const name =
      (file instanceof File && file.name ? file.name : "document").slice(0, 255);
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = (await query<DbResult>(
      `INSERT INTO user_documents
         (user_id, category, note, filename, mime_type, size_bytes, data)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [user.id, category, note, name, file.type || null, buffer.length, buffer]
    )) as unknown as DbResult;

    // The name of the file, never anything from inside it.
    await logActivity({
      userId: user.id,
      action: "document.uploaded",
      entityType: "user",
      entityId: user.id,
      metadata: { filename: name, category },
    });

    const [row] = await query<DbRow[]>(
      `SELECT id, user_id, category, note, filename, mime_type, size_bytes, created_at
         FROM user_documents WHERE id = ?`,
      [result.insertId]
    );
    return json({ document: row }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
