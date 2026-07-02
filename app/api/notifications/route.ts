import { requireUser } from "@/lib/auth";
import { query, DbRow } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await query<DbRow[]>(
      `SELECT id, user_id, type, message, link, is_read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 30`,
      [user.id]
    );
    const unread = rows.filter((r) => !r.is_read).length;
    return json({
      notifications: rows.map((r) => ({ ...r, is_read: Boolean(r.is_read) })),
      unread,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// Mark all of the current user's notifications as read.
export async function PATCH() {
  try {
    const user = await requireUser();
    await query(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE`,
      [user.id]
    );
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
