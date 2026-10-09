import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { isDateKey, todayIst } from "@/lib/planner";
import { canReadPlanner } from "@/lib/planner-data";
import { dailySummary } from "@/lib/daily-summary";

export const dynamic = "force-dynamic";

/**
 * GET /api/planner/summary?date=&userId= — what the app recorded of that
 * person's day. Worked out on every read rather than stored, so it is right
 * the moment someone logs time, without anything having to be rebuilt.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const params = new URL(req.url).searchParams;
    const date = params.get("date") ?? todayIst();
    if (!isDateKey(date)) throw new ApiError(400, "Expected date as YYYY-MM-DD");

    const asked = params.get("userId");
    const forUser = asked ? Number(asked) : user.id;
    if (!Number.isInteger(forUser) || forUser <= 0) throw new ApiError(400, "Invalid userId");
    if (!(await canReadPlanner(user, forUser))) {
      throw forbidden("That planner is not yours to read");
    }

    return json({ date, summary: await dailySummary(forUser, date) });
  } catch (err) {
    return errorResponse(err);
  }
}
