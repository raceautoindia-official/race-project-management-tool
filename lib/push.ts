import "server-only";
import webpush from "web-push";
import { query, DbRow } from "./db";

/**
 * lib/push.ts — Web Push (out-of-app browser notifications) via VAPID.
 *
 * Configured from NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY + VAPID_SUBJECT.
 * If unset it's a no-op, so the app works before push is configured. Dead
 * subscriptions (404/410) are pruned automatically.
 */

const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

let ready = false;
export function pushConfigured(): boolean {
  return Boolean(PUBLIC && PRIVATE);
}
function ensure(): boolean {
  if (!pushConfigured()) return false;
  if (!ready) {
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    ready = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** Best-effort push to all of a user's subscribed devices. Never throws. */
export async function sendPushToUser(
  userId: number,
  payload: PushPayload
): Promise<void> {
  if (!ensure()) return;
  try {
    const subs = await query<DbRow[]>(
      `SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`,
      [userId]
    );
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint as string,
              keys: { p256dh: s.p256dh as string, auth: s.auth as string },
            },
            JSON.stringify(payload)
          );
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await query(`DELETE FROM push_subscriptions WHERE id = ?`, [
              s.id,
            ]).catch(() => {});
          }
        }
      })
    );
  } catch {
    /* best-effort */
  }
}
