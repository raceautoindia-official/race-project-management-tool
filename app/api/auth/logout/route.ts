import { clearSessionCookie, getSessionUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";
import { logActivity } from "@/lib/activity";

export async function POST() {
  try {
    const session = await getSessionUser();
    await clearSessionCookie();
    if (session) {
      await logActivity({
        userId: session.userId,
        action: "user.logout",
        entityType: "user",
        entityId: session.userId,
      });
    }
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
