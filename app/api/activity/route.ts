import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { query, DbRow } from "@/lib/db";
import { json, errorResponse, getPagination } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const action = (searchParams.get("action") ?? "").trim();
    const entityType = (searchParams.get("entityType") ?? "").trim();
    const { page, pageSize, offset } = getPagination(searchParams);

    const where: string[] = [];
    const params: unknown[] = [];
    if (action) {
      where.push("al.action = ?");
      params.push(action);
    }
    if (entityType) {
      where.push("al.entity_type = ?");
      params.push(entityType);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query<DbRow[]>(
      `SELECT al.id, al.user_id, al.action, al.entity_type, al.entity_id,
              al.metadata, al.created_at, u.name AS user_name
       FROM activity_log al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereSql}
       ORDER BY al.created_at DESC, al.id DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
      params
    );
    const countRows = await query<DbRow[]>(
      `SELECT COUNT(*) AS total FROM activity_log al ${whereSql}`,
      params
    );

    return json({
      activity: rows,
      total: Number(countRows[0]?.total ?? 0),
      page,
      pageSize,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
