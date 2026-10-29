import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, conflict } from "@/lib/http";
import { entryDateFor, isDateKey, isLocked, todayIst } from "@/lib/planner";

export const dynamic = "force-dynamic";

/**
 * POST { period, date } — hand in your own update for that day or week.
 *
 * It stays editable until midnight (Saturday midnight for a week), and
 * stays submitted while you edit it. Something has to be written first: the
 * app hands in empty days by itself at the end of the day.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const period = body.period === "week" ? "week" : "day";
    const date = String(body.date ?? todayIst());
    if (!isDateKey(date)) throw new ApiError(400, "Expected date as YYYY-MM-DD");
    const entryDate = entryDateFor(period, date);
    if (isLocked(period, entryDate, todayIst())) {
      throw conflict("This is locked — updates close at midnight.");
    }

    const [entry] = await query<DbRow[]>(
      `SELECT plan, progress FROM planner_entries WHERE user_id = ? AND period = ? AND entry_date = ? LIMIT 1`,
      [user.id, period, entryDate]
    );
    if (!entry || (!entry.plan && !entry.progress)) {
      throw new ApiError(400, "Write your update and save it before submitting.");
    }
    await query(
      `UPDATE planner_entries SET submitted_at = UTC_TIMESTAMP(), submission = 'manual'
        WHERE user_id = ? AND period = ? AND entry_date = ?`,
      [user.id, period, entryDate]
    );
    const [row] = await query<DbRow[]>(
      `SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, period, plan, progress, submitted_at, submission, updated_at
         FROM planner_entries WHERE user_id = ? AND period = ? AND entry_date = ? LIMIT 1`,
      [user.id, period, entryDate]
    );
    return json({ entry: row });
  } catch (err) {
    return errorResponse(err);
  }
}
