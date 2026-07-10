import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";
import { assertCron } from "@/lib/cron";
import { sendEmail, emailLayout, appBaseUrl } from "@/lib/mailer";
import { formatIst } from "@/lib/tz";

export const dynamic = "force-dynamic";

/**
 * POST /api/cron/weekly-digest   (header: x-cron-secret)
 *
 * Emails each active user with an address a personal summary: their open tasks
 * (with due dates), how many are overdue, and meetings in the next 7 days.
 * Users with nothing to report are skipped. Run weekly (e.g. Monday 08:00).
 */
export async function POST(req: NextRequest) {
  try {
    assertCron(req);
    const base = appBaseUrl();

    const users = await query<DbRow[]>(
      `SELECT id, name, email FROM users WHERE is_active = TRUE AND email IS NOT NULL`
    );

    let sent = 0;
    for (const u of users) {
      const openTasks = await query<DbRow[]>(
        `SELECT t.title, t.due_date, t.status, p.name AS project_name,
                (t.due_date IS NOT NULL AND t.due_date < UTC_DATE()) AS overdue
           FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE t.assignee_id = ? AND t.status <> 'done'
          ORDER BY (t.due_date IS NULL), t.due_date ASC
          LIMIT 25`,
        [u.id]
      );
      const meetings = await query<DbRow[]>(
        `SELECT m.title, m.start_time, p.name AS project_name
           FROM meetings m LEFT JOIN projects p ON p.id = m.project_id
          WHERE m.start_time BETWEEN UTC_TIMESTAMP() AND (UTC_TIMESTAMP() + INTERVAL 7 DAY)
            AND (m.created_by = ? OR m.id IN (
              SELECT meeting_id FROM meeting_attendees WHERE user_id = ?
            ))
          ORDER BY m.start_time ASC`,
        [u.id, u.id]
      );

      if (openTasks.length === 0 && meetings.length === 0) continue;

      const overdueCount = openTasks.filter((t) => Number(t.overdue)).length;
      const taskRows = openTasks
        .map(
          (t) =>
            `<tr>
               <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;">${t.title}</td>
               <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;color:#64748b;">${t.project_name}</td>
               <td style="padding:4px 8px;border-bottom:1px solid #f1f5f9;color:${
                 Number(t.overdue) ? "#dc2626" : "#64748b"
               };">${t.due_date ?? "—"}</td>
             </tr>`
        )
        .join("");
      const meetingRows = meetings
        .map(
          (m) =>
            `<li><strong>${formatIst(String(m.start_time))}</strong> — ${m.title}${
              m.project_name ? ` (${m.project_name})` : ""
            }</li>`
        )
        .join("");

      await sendEmail({
        to: u.email as string,
        subject: `Your PMApp weekly summary — ${openTasks.length} open task(s)`,
        html: emailLayout(
          `Hi ${String(u.name).split(" ")[0]}, here's your week`,
          `<p><strong>${openTasks.length}</strong> open task(s)${
            overdueCount ? `, <span style="color:#dc2626;">${overdueCount} overdue</span>` : ""
          }.</p>
           ${
             openTasks.length
               ? `<table style="border-collapse:collapse;width:100%;font-size:13px;">
                    <tr><th align="left" style="padding:4px 8px;">Task</th><th align="left" style="padding:4px 8px;">Project</th><th align="left" style="padding:4px 8px;">Due</th></tr>
                    ${taskRows}
                  </table>`
               : ""
           }
           ${
             meetings.length
               ? `<p style="margin-top:16px;"><strong>Meetings in the next 7 days:</strong></p><ul>${meetingRows}</ul>`
               : ""
           }
           <p style="margin-top:16px;"><a href="${base}/dashboard">Open your dashboard →</a></p>`
        ),
      });
      sent++;
    }

    return json({ ok: true, digestsSent: sent });
  } catch (err) {
    return errorResponse(err);
  }
}
