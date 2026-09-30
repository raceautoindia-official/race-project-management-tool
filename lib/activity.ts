import { pool } from "./db";
import { sendPushToUser } from "./push";
import { sendWhatsAppToUser } from "./whatsapp";

interface LogInput {
  userId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Append an audit row. Best-effort: a logging failure must never break the
 * primary request, so errors are swallowed (after being logged to console).
 */
export async function logActivity(input: LogInput): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO activity_log (user_id, action, entity_type, entity_id, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      [
        input.userId,
        input.action,
        input.entityType,
        input.entityId ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    );
  } catch (err) {
    console.error("Failed to write activity log:", err);
  }
}

/**
 * Create an in-app notification (best-effort). Also web-pushes and sends a
 * WhatsApp alert (to people who opted in), unless switched off per call.
 */
export async function notify(
  userId: number,
  type: string,
  message: string,
  link?: string | null,
  opts?: { push?: boolean; whatsapp?: boolean }
): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO notifications (user_id, type, message, link)
       VALUES (?, ?, ?, ?)`,
      [userId, type, message, link ?? null]
    );
    // Fan out to the browser (best-effort; no-op if push isn't configured).
    if (opts?.push !== false) {
      void sendPushToUser(userId, { title: "PMApp", body: message, url: link ?? "/" });
    }
    // …and to WhatsApp (no-op unless configured and opted in).
    if (opts?.whatsapp !== false) {
      void sendWhatsAppToUser(userId, message, link ?? null);
    }
  } catch (err) {
    console.error("Failed to write notification:", err);
  }
}
