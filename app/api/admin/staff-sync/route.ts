import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, forbidden } from "@/lib/http";
import { syncStaffWithAttendance } from "@/lib/staff-sync";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * POST { force? } — check everyone against Attendance now (admin). The same
 * sweep runs on the work-updates cron; this is for not waiting for it, and for
 * confirming a large change the automatic run held back.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") throw forbidden("Only an admin can do this");
    const body = await req.json().catch(() => ({}));
    const result = await syncStaffWithAttendance({ force: body.force === true });
    if (result.retired.length || result.returned.length) {
      await logActivity({
        userId: user.id,
        action: "staff.synced",
        entityType: "settings",
        entityId: 0,
        metadata: {
          retired: result.retired.map((c) => c.name),
          returned: result.returned.map((c) => c.name),
        },
      });
    }
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
