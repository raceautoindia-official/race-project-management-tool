import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { isDateKey, todayIst } from "@/lib/planner";
import { VISIBLE_USER_SQL, visibleParams } from "@/lib/planner-data";
import { getUpdateSettings, sendReminders, stillOwing, type ReminderKind } from "@/lib/work-updates";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const KINDS: ReminderKind[] = ["day", "week_plan", "week_summary"];

/**
 * POST { kind, date, userIds? } — remind people about an update now.
 *
 * kind: day | week_plan | week_summary. Without userIds, everyone you may
 * read (an admin: everyone; a lead: their projects' people) who still owes
 * it. Anyone who has already done it is skipped either way.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const kind = body.kind as ReminderKind;
    if (!KINDS.includes(kind)) throw new ApiError(400, "kind must be day, week_plan or week_summary");
    const date = String(body.date ?? todayIst());
    if (!isDateKey(date)) throw new ApiError(400, "Expected date as YYYY-MM-DD");

    const asked: number[] | null = Array.isArray(body.userIds)
      ? body.userIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : null;
    // The people this person may read, who write updates at all.
    const readable = await query<DbRow[]>(
      `SELECT u.id, u.name, u.email FROM users u
        WHERE u.is_active = 1 AND u.role <> 'admin' AND u.id <> ? AND ${VISIBLE_USER_SQL}
        ORDER BY u.name`,
      [user.id, ...visibleParams(user)]
    );
    if (!readable.length) throw forbidden("There is nobody here you can remind");
    let people = readable;
    if (asked) {
      const allowed = new Set(readable.map((r) => Number(r.id)));
      if (asked.some((id) => !allowed.has(id))) throw forbidden("You can only remind people whose updates you can read");
      people = readable.filter((r) => asked.includes(Number(r.id)));
    }

    const owing = await stillOwing(kind, date, people);
    const sent = await sendReminders(kind, date, owing, user.id, await getUpdateSettings());
    if (sent) {
      await logActivity({
        userId: user.id,
        action: "work_update.reminded",
        entityType: "user",
        entityId: owing.length === 1 ? Number(owing[0].id) : user.id,
        metadata: { kind, date, people: owing.map((p) => p.name) },
      });
    }
    return json({ sent, skipped: people.length - sent });
  } catch (err) {
    return errorResponse(err);
  }
}
