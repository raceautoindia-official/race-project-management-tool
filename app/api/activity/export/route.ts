import { requireAdmin } from "@/lib/auth";
import { query, DbRow } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { toCsv, csvResponse } from "@/lib/csv";

export async function GET() {
  try {
    await requireAdmin();
    const rows = await query<DbRow[]>(
      `SELECT al.id, al.created_at, u.name AS user_name, al.action,
              al.entity_type, al.entity_id, al.metadata
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.user_id
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT 5000`
    );
    const csv = toCsv(
      ["ID", "When", "User", "Action", "Entity type", "Entity id", "Metadata"],
      rows.map((r) => [
        r.id,
        r.created_at,
        r.user_name ?? "System",
        r.action,
        r.entity_type,
        r.entity_id ?? "",
        r.metadata ? JSON.stringify(r.metadata) : "",
      ])
    );
    return csvResponse("activity_log.csv", csv);
  } catch (err) {
    return errorResponse(err);
  }
}
