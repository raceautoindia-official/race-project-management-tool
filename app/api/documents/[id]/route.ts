import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET — download the file. Its owner, or an admin.
 *
 * An admin opening someone else's document is recorded. Somebody has to be
 * able to look at these; nobody should be able to look at them unobserved.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const docId = Number(id);
    if (!Number.isInteger(docId)) throw new ApiError(400, "Invalid id");

    const [doc] = await query<DbRow[]>(
      `SELECT id, user_id, filename, mime_type, data FROM user_documents WHERE id = ? LIMIT 1`,
      [docId]
    );
    if (!doc) throw new ApiError(404, "Document not found");

    const mine = doc.user_id === user.id;
    if (!mine && user.role !== "admin") {
      throw forbidden("This is not yours to look at");
    }
    if (!mine) {
      await logActivity({
        userId: user.id,
        action: "document.viewed",
        entityType: "user",
        entityId: doc.user_id as number,
        metadata: { filename: doc.filename },
      });
    }

    const data: Buffer = doc.data;
    const safe = String(doc.filename).replace(/[^\w.\- ]+/g, "_");
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": (doc.mime_type as string) || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safe}"`,
        "Content-Length": String(data.length),
        // Someone's ID proof has no business in a shared cache.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE — remove one of your own.
 *
 * An admin cannot: these are the owner's, and a record that can be quietly
 * removed by someone else is not much of a record. Deactivating the account
 * removes them with it.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const docId = Number(id);
    if (!Number.isInteger(docId)) throw new ApiError(400, "Invalid id");

    const [doc] = await query<DbRow[]>(
      `SELECT id, user_id, filename FROM user_documents WHERE id = ? LIMIT 1`,
      [docId]
    );
    if (!doc) throw new ApiError(404, "Document not found");
    if (doc.user_id !== user.id) {
      throw forbidden("Only the person it belongs to can remove it");
    }

    await query(`DELETE FROM user_documents WHERE id = ?`, [docId]);
    await logActivity({
      userId: user.id,
      action: "document.deleted",
      entityType: "user",
      entityId: user.id,
      metadata: { filename: doc.filename },
    });
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
