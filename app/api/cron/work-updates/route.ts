import { NextRequest } from "next/server";
import { json, errorResponse } from "@/lib/http";
import { assertCron } from "@/lib/cron";
import { runWorkUpdateJobs } from "@/lib/work-updates";
import { syncStaffWithAttendance } from "@/lib/staff-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/work-updates   (header: x-cron-secret)
 *
 * Run every 15 minutes. Sends the daily, weekly-plan and weekly-summary
 * reminders at the times set in Admin › Update reminders, submits unsubmitted
 * updates at the end of the day (and of the week on Saturday), and sends
 * admins the morning digest. Each job runs once per day however often this
 * is called, and a missed day is caught up on the next call.
 *
 * First, every time, it checks everyone against Attendance (lib/staff-sync),
 * so people who have left are retired before anyone is reminded.
 *
 * crontab, every 15 minutes (minute field "0,15,30,45"):
 *   0,15,30,45 * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" \
 *     https://projectmanager.raceinnovations.in/api/cron/work-updates
 */
export async function POST(req: NextRequest) {
  try {
    assertCron(req);
    const staff = await syncStaffWithAttendance();
    return json({
      staff: { retired: staff.retired.length, returned: staff.returned.length, held: staff.held },
      ran: await runWorkUpdateJobs(),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
