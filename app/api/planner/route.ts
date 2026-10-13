import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { entryDateFor, isDateKey, todayIst, type PlannerPeriod } from "@/lib/planner";
import { canReadPlanner, plannerForPeriod, plannerRange } from "@/lib/planner-data";

export const dynamic = "force-dynamic";

const MAX_TEXT = 4000;

function periodOf(value: string | null): PlannerPeriod {
  return value === "week" ? "week" : "day";
}

/**
 * GET /api/planner?period=&date=&userId=&scope=
 *
 *   scope=mine (default) — one person's entry for that period
 *   scope=team           — everyone you may read, for that period
 *   scope=range&from&to  — one person's entries across a range
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;
    const period = periodOf(params.get("period"));
    const date = params.get("date") ?? todayIst();
    if (!isDateKey(date)) throw new ApiError(400, "Expected date as YYYY-MM-DD");
    const entryDate = entryDateFor(period, date);

    const scope = params.get("scope") ?? "mine";
    if (scope === "team") {
      return json({ period, entryDate, entries: await plannerForPeriod(user, period, entryDate) });
    }

    const asked = params.get("userId");
    const forUser = asked ? Number(asked) : user.id;
    if (!Number.isInteger(forUser) || forUser <= 0) throw new ApiError(400, "Invalid userId");
    if (!(await canReadPlanner(user, forUser))) {
      throw forbidden("That planner is not yours to read");
    }

    if (scope === "range") {
      const from = params.get("from") ?? entryDate;
      const to = params.get("to") ?? entryDate;
      if (!isDateKey(from) || !isDateKey(to)) {
        throw new ApiError(400, "Expected from and to as YYYY-MM-DD");
      }
      return json({ period, entries: await plannerRange(forUser, period, from, to) });
    }

    const rows = await query<DbRow[]>(
      `SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, period, plan, progress, updated_at
         FROM planner_entries
        WHERE user_id = ? AND period = ? AND entry_date = ? LIMIT 1`,
      [forUser, period, entryDate]
    );
    return json({ period, entryDate, entry: rows[0] ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * PUT { period, date, plan, progress } — write your own entry.
 *
 * Yours alone: a planner somebody else can edit is not a record of what you
 * said you would do. One row per person per period, replaced in place.
 */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const period = periodOf(body.period);
    const date = String(body.date ?? todayIst());
    if (!isDateKey(date)) throw new ApiError(400, "Expected date as YYYY-MM-DD");
    const entryDate = entryDateFor(period, date);

    const plan = String(body.plan ?? "").slice(0, MAX_TEXT).trim() || null;
    const progress = String(body.progress ?? "").slice(0, MAX_TEXT).trim() || null;

    if (plan === null && progress === null) {
      // Emptying both is how you take an entry back.
      await query(
        `DELETE FROM planner_entries WHERE user_id = ? AND period = ? AND entry_date = ?`,
        [user.id, period, entryDate]
      );
      return json({ entry: null });
    }

    await query(
      `INSERT INTO planner_entries (user_id, period, entry_date, plan, progress)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE plan = VALUES(plan), progress = VALUES(progress)`,
      [user.id, period, entryDate, plan, progress]
    );

    const [row] = await query<DbRow[]>(
      `SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, period, plan, progress, updated_at
         FROM planner_entries
        WHERE user_id = ? AND period = ? AND entry_date = ? LIMIT 1`,
      [user.id, period, entryDate]
    );
    return json({ entry: row ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}
