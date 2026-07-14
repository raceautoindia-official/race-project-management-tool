import { NextRequest } from "next/server";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";

export const dynamic = "force-dynamic";

/** POST — save a Web Push subscription for the current user. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const sub = body.subscription ?? body;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      throw new ApiError(400, "Invalid subscription");
    }
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id),
         p256dh = VALUES(p256dh), auth = VALUES(auth)`,
      [user.id, endpoint, p256dh, auth]
    );
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE — remove a subscription (unsubscribe). */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const endpoint = body?.endpoint;
    if (endpoint) {
      await query(
        `DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`,
        [user.id, endpoint]
      );
    }
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
