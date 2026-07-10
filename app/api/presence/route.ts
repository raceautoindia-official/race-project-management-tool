import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query, DbRow } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/presence — admin-only live team presence + activity counts. */
export async function GET(_req: NextRequest) {
  try {
    await requireAdmin();
    const rows = await query<DbRow[]>(
      `SELECT u.id, u.name, u.role, u.last_seen_at,
              (u.last_seen_at IS NOT NULL
                AND u.last_seen_at >= UTC_TIMESTAMP() - INTERVAL 5 MINUTE) AS online,
              (SELECT COUNT(*) FROM activity_log al WHERE al.user_id = u.id) AS activity_count
         FROM users u
        WHERE u.is_active = TRUE
        ORDER BY online DESC, u.last_seen_at DESC, u.name ASC`
    );
    const users = rows.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      last_seen_at: u.last_seen_at,
      online: Boolean(Number(u.online)),
      activity_count: Number(u.activity_count),
    }));
    return json({ online: users.filter((u) => u.online).length, users });
  } catch (err) {
    return errorResponse(err);
  }
}
