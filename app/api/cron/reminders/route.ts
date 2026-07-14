import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";
import { assertCron } from "@/lib/cron";
import { notify } from "@/lib/activity";
import { sendEmail, emailLayout, appBaseUrl } from "@/lib/mailer";
import { formatIst } from "@/lib/tz";
import { REMINDER_CATEGORY_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Advance a UTC "YYYY-MM-DD HH:MM:SS" to the next future occurrence. */
function nextOccurrence(utc: string, recurrence: string): string {
  const d = new Date(String(utc).replace(" ", "T") + "Z");
  const now = Date.now();
  const step = () => {
    if (recurrence === "daily") d.setUTCDate(d.getUTCDate() + 1);
    else if (recurrence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
    else if (recurrence === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  };
  do {
    step();
  } while (d.getTime() <= now);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * POST /api/cron/reminders  (header: x-cron-secret)
 *
 * Fires reminders whose "reminder_minutes before scheduled time" has arrived:
 * in-app notification, plus email (if enabled) and web push (if enabled).
 * Recurring reminders re-arm to their next occurrence; one-off ones are marked
 * sent. Run every few minutes.
 */
export async function POST(req: NextRequest) {
  try {
    assertCron(req);
    const base = appBaseUrl();

    const due = await query<DbRow[]>(
      `SELECT r.id, r.user_id, r.title, r.category, r.notes, r.scheduled_at,
              r.recurrence, r.notify_email, r.notify_push, u.email, u.name
         FROM reminders r JOIN users u ON u.id = r.user_id
        WHERE r.is_done = 0 AND r.reminder_sent = 0
          AND (r.scheduled_at - INTERVAL r.reminder_minutes MINUTE) <= UTC_TIMESTAMP()`
    );

    let fired = 0;
    for (const r of due) {
      const whenIst = formatIst(String(r.scheduled_at));
      const label = REMINDER_CATEGORY_LABELS[r.category] ?? r.category;

      await notify(
        r.user_id,
        "reminder",
        `${label} reminder: ${r.title} — ${whenIst}`,
        "/reminders",
        { push: Boolean(r.notify_push) }
      );

      if (r.notify_email && r.email) {
        await sendEmail({
          to: [r.email as string],
          subject: `Reminder: ${r.title}`,
          html: emailLayout(
            `${label} reminder`,
            `<p><strong>${r.title}</strong> is scheduled for <strong>${whenIst}</strong> (IST).</p>
             ${r.notes ? `<p>${r.notes}</p>` : ""}
             <p><a href="${base}/reminders">View your reminders →</a></p>`
          ),
        });
      }

      if (r.recurrence && r.recurrence !== "none") {
        const next = nextOccurrence(String(r.scheduled_at), r.recurrence);
        await query(
          `UPDATE reminders SET scheduled_at = ?, reminder_sent = 0 WHERE id = ?`,
          [next, r.id]
        );
      } else {
        await query(`UPDATE reminders SET reminder_sent = 1 WHERE id = ?`, [r.id]);
      }
      fired++;
    }

    return json({ ok: true, fired });
  } catch (err) {
    return errorResponse(err);
  }
}
