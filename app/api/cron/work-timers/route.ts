import { NextRequest } from "next/server";
import { assertCron } from "@/lib/cron";
import { json, errorResponse } from "@/lib/http";
import { reconcileTimers } from "@/lib/work-timer";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/work-timers — stop the work timer of anyone who clocked out
 * on Attendance (at their clock-out time), left, or whose work closed.
 * People with PM open are checked on every page load anyway; this catches
 * those who closed the tab. Run it every five minutes.
 */
export async function POST(req: NextRequest) {
  try {
    assertCron(req);
    const res = await reconcileTimers();
    return json({ stopped: res.stopped.length, attendanceUnavailable: res.attendanceUnavailable });
  } catch (err) {
    return errorResponse(err);
  }
}
