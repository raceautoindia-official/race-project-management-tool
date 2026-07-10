import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";
import { assertCron } from "@/lib/cron";
import { notify } from "@/lib/activity";
import { projectAlertRecipients } from "@/lib/recipients";
import { sendEmail, emailLayout, appBaseUrl } from "@/lib/mailer";

export const dynamic = "force-dynamic";

const DUE_SOON_DAYS = Number(process.env.DUE_SOON_DAYS ?? 2);

/**
 * POST /api/cron/due-date-alerts   (header: x-cron-secret)
 *
 * Sweeps tasks and:
 *  • "due soon" (due within DUE_SOON_DAYS, not done, not yet alerted) → emails
 *    the project lead(s) + admins, notifies the assignee, marks due_alert_sent.
 *  • "overdue"  (past due, not done, not yet flagged) → marks the task
 *    `outstanding`, emails the lead(s) + admins, notifies the assignee.
 */
export async function POST(req: NextRequest) {
  try {
    assertCron(req);
    const base = appBaseUrl();
    let dueSoonCount = 0;
    let overdueCount = 0;

    // ── due soon ──────────────────────────────────────────────────────────
    const dueSoon = await query<DbRow[]>(
      `SELECT t.id, t.project_id, t.title, t.due_date, t.assignee_id,
              p.name AS project_name, a.name AS assignee_name, a.email AS assignee_email
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN users a ON a.id = t.assignee_id
        WHERE t.status <> 'done'
          AND t.due_alert_sent = 0
          AND t.due_date IS NOT NULL
          AND t.due_date BETWEEN UTC_DATE() AND (UTC_DATE() + INTERVAL ? DAY)`,
      [DUE_SOON_DAYS]
    );

    for (const t of dueSoon) {
      const recipients = await projectAlertRecipients(t.project_id);
      const emails = recipients.map((r) => r.email);
      if (t.assignee_email) emails.push(t.assignee_email);
      const link = `${base}/projects/${t.project_id}`;
      await sendEmail({
        to: emails,
        subject: `Task due soon: ${t.title}`,
        html: emailLayout(
          "Task due soon",
          `<p><strong>${t.title}</strong> in project <strong>${t.project_name}</strong> is due on <strong>${t.due_date}</strong>.</p>
           <p>Assignee: ${t.assignee_name ?? "Unassigned"}</p>
           <p><a href="${link}">Open the project →</a></p>`
        ),
      });
      if (t.assignee_id) {
        await notify(
          t.assignee_id,
          "task_due_soon",
          `Task "${t.title}" is due on ${t.due_date}`,
          `/projects/${t.project_id}`
        );
      }
      await query(`UPDATE tasks SET due_alert_sent = 1 WHERE id = ?`, [t.id]);
      dueSoonCount++;
    }

    // ── overdue → outstanding ─────────────────────────────────────────────
    const overdue = await query<DbRow[]>(
      `SELECT t.id, t.project_id, t.title, t.due_date, t.assignee_id,
              p.name AS project_name, a.name AS assignee_name,
              DATEDIFF(UTC_DATE(), t.due_date) AS days_overdue
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN users a ON a.id = t.assignee_id
        WHERE t.status <> 'done'
          AND t.outstanding = 0
          AND t.due_date IS NOT NULL
          AND t.due_date < UTC_DATE()`
    );

    for (const t of overdue) {
      await query(`UPDATE tasks SET outstanding = 1 WHERE id = ?`, [t.id]);
      const recipients = await projectAlertRecipients(t.project_id);
      const link = `${base}/outstanding`;
      await sendEmail({
        to: recipients.map((r) => r.email),
        subject: `Overdue task: ${t.title}`,
        html: emailLayout(
          "Task is overdue",
          `<p><strong>${t.title}</strong> in project <strong>${t.project_name}</strong> was due on <strong>${t.due_date}</strong> (${t.days_overdue} day(s) ago) and is not complete.</p>
           <p>Assignee: ${t.assignee_name ?? "Unassigned"}</p>
           <p>It has been moved to the outstanding list. <a href="${link}">Review outstanding tasks →</a></p>`
        ),
      });
      for (const r of recipients) {
        await notify(
          r.id,
          "task_overdue",
          `Overdue: "${t.title}" (${t.days_overdue}d) in ${t.project_name}`,
          `/outstanding`
        );
      }
      if (t.assignee_id) {
        await notify(
          t.assignee_id,
          "task_overdue",
          `Your task "${t.title}" is overdue`,
          `/projects/${t.project_id}`
        );
      }
      overdueCount++;
    }

    return json({ ok: true, dueSoon: dueSoonCount, overdue: overdueCount });
  } catch (err) {
    return errorResponse(err);
  }
}
