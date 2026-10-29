import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, forbidden } from "@/lib/http";
import { getUpdateSettings, saveUpdateSettings } from "@/lib/work-updates";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** GET — when work-update reminders go out (admin). */
export async function GET() {
  try {
    const user = await requireUser();
    if (user.role !== "admin") throw forbidden("Only an admin can see these settings");
    return json({ settings: await getUpdateSettings() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PUT { settings } — change them. Anything malformed falls back to the default. */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") throw forbidden("Only an admin can change these settings");
    const body = await req.json().catch(() => ({}));
    const settings = await saveUpdateSettings(body.settings ?? body, user.id);
    await logActivity({
      userId: user.id,
      action: "settings.work_updates_changed",
      entityType: "settings",
      entityId: 0,
      metadata: settings as unknown as Record<string, unknown>,
    });
    return json({ settings });
  } catch (err) {
    return errorResponse(err);
  }
}
