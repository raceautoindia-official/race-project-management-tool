import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";
import { assertCron } from "@/lib/cron";
import { notify } from "@/lib/activity";
import { sendEmail, emailLayout, appBaseUrl } from "@/lib/mailer";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/meeting-reminders   (header: x-cron-secret)
 *
 * Fires reminders for meetings whose reminder window has arrived: the meeting
 * has a reminder_minutes set, hasn't been reminded yet, its start is still in
 * the future, and (start_time - reminder_minutes) <= now. Notifies every
 * attendee in-app + by email, then marks reminder_sent.
 *
 * Run every few minutes from system cron for punctual reminders.
 */
export async function POST(req: NextRequest) {
  try {
    assertCron(req);
    const base = appBaseUrl();

    const due = await query<DbRow[]>(
      `SELECT m.id, m.title, m.description, m.location, m.start_time,
              p.name AS project_name
         FROM meetings m
         LEFT JOIN projects p ON p.id = m.project_id
        WHERE m.reminder_minutes IS NOT NULL
          AND m.reminder_sent = 0
          AND m.start_time > UTC_TIMESTAMP()
          AND (m.start_time - INTERVAL m.reminder_minutes MINUTE) <= UTC_TIMESTAMP()`
    );

    let sent = 0;
    for (const m of due) {
      const attendees = await query<DbRow[]>(
        `SELECT u.id, u.name, u.email
           FROM meeting_attendees ma JOIN users u ON u.id = ma.user_id
          WHERE ma.meeting_id = ?`,
        [m.id]
      );

      const where = m.location ? `<p>Where: ${m.location}</p>` : "";
      const proj = m.project_name ? `<p>Project: ${m.project_name}</p>` : "";
      await sendEmail({
        to: attendees.map((a) => a.email),
        subject: `Reminder: ${m.title} at ${m.start_time}`,
        html: emailLayout(
          "Upcoming meeting",
          `<p><strong>${m.title}</strong> starts at <strong>${m.start_time}</strong> (UTC).</p>
           ${proj}${where}
           ${m.description ? `<p>${m.description}</p>` : ""}
           <p><a href="${base}/meetings">View in PMApp →</a></p>`
        ),
      });

      for (const a of attendees) {
        await notify(
          a.id,
          "meeting_reminder",
          `Reminder: "${m.title}" starts at ${m.start_time}`,
          `/meetings`
        );
      }

      await query(`UPDATE meetings SET reminder_sent = 1 WHERE id = ?`, [m.id]);
      sent++;
    }

    return json({ ok: true, remindersSent: sent });
  } catch (err) {
    return errorResponse(err);
  }
}
