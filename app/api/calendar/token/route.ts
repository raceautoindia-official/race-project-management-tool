import { randomBytes } from "node:crypto";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";
import { appBaseUrl } from "@/lib/mailer";
import { calendarFeedUrl } from "@/lib/calendar-links";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

function feedUrl(token: string): string {
  return calendarFeedUrl(appBaseUrl(), token);
}

/**
 * POST /api/calendar/token — the caller's calendar subscription link.
 * Creates one on first use; `{ "rotate": true }` replaces it, which instantly
 * stops every calendar still subscribed with the old link.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { rotate } = (await req.json().catch(() => ({}))) as { rotate?: boolean };

    const [row] = await query<DbRow[]>(`SELECT calendar_token FROM users WHERE id = ?`, [user.id]);
    let token = (row?.calendar_token as string | null) ?? null;

    if (!token || rotate) {
      token = randomBytes(16).toString("hex");
      // A new link is a new subscription: whatever was reading the old one
      // is now cut off, so the "last read" evidence no longer applies.
      await query(
        `UPDATE users SET calendar_token = ?, calendar_feed_fetched_at = NULL WHERE id = ?`,
        [token, user.id]
      );
      if (rotate) {
        await logActivity({
          userId: user.id,
          action: "user.calendar_link_reset",
          entityType: "user",
          entityId: user.id,
        });
      }
    }

    return json({ token, url: feedUrl(token) });
  } catch (err) {
    return errorResponse(err);
  }
}
