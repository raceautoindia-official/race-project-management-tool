import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";
import { assertCron } from "@/lib/cron";
import { notify } from "@/lib/activity";
import { projectAlertRecipients } from "@/lib/recipients";
import { sendEmail, emailLayout, appBaseUrl, escapeHtml } from "@/lib/mailer";

export const dynamic = "force-dynamic";

const DUE_SOON_DAYS = Number(process.env.DUE_SOON_DAYS ?? 2);

/**
 * POST /api/cron/due-date-alerts   (header: x-cron-secret)
 *
 * Sweeps tasks (and subtasks, which only notify — see below) and:
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
          AND p.approval_status = 'approved' AND p.status <> 'completed'
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
          `<p><strong>${escapeHtml(t.title)}</strong> in project <strong>${escapeHtml(t.project_name)}</strong> is due on <strong>${escapeHtml(t.due_date)}</strong>.</p>
           <p>Assignee: ${escapeHtml(t.assignee_name ?? "Unassigned")}</p>
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
          AND p.approval_status = 'approved' AND p.status <> 'completed'
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
          `<p><strong>${escapeHtml(t.title)}</strong> in project <strong>${escapeHtml(t.project_name)}</strong> was due on <strong>${escapeHtml(t.due_date)}</strong> (${escapeHtml(t.days_overdue)} day(s) ago) and is not complete.</p>
           <p>Assignee: ${escapeHtml(t.assignee_name ?? "Unassigned")}</p>
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

    // ── subtasks: tell the person doing it, and the task owner ───────────
    // One reminder when due soon, one when overdue (due_alert_sent 1, then 2).
    const subtasks = await query<DbRow[]>(
      `SELECT s.id, s.title, s.due_date, s.assignee_id, s.due_alert_sent,
              t.id AS task_id, t.title AS task_title, t.project_id, t.assignee_id AS owner_id,
              (s.due_date < UTC_DATE()) AS overdue
         FROM subtasks s
         JOIN tasks t ON t.id = s.task_id
         JOIN projects p ON p.id = t.project_id
        WHERE s.status IN ('todo','in_progress')
          AND t.signed_off_at IS NULL
          AND p.approval_status = 'approved' AND p.status <> 'completed'
          AND s.due_date IS NOT NULL
          AND ((s.due_alert_sent = 0 AND s.due_date <= UTC_DATE() + INTERVAL ? DAY)
            OR (s.due_alert_sent < 2 AND s.due_date < UTC_DATE()))`,
      [DUE_SOON_DAYS]
    );
    let subtaskAlerts = 0;
    for (const s of subtasks) {
      const overdue = Number(s.overdue) === 1;
      const link = `/projects/${s.project_id}?task=${s.task_id}&subtask=${s.id}`;
      const what = `"${s.title}" (in "${s.task_title}")`;
      if (s.assignee_id) {
        await notify(
          s.assignee_id,
          overdue ? "subtask_overdue" : "subtask_due_soon",
          overdue ? `Your subtask ${what} is overdue` : `Your subtask ${what} is due on ${s.due_date}`,
          link
        );
      }
      if (overdue && s.owner_id && s.owner_id !== s.assignee_id) {
        await notify(s.owner_id, "subtask_overdue", `Subtask ${what} is overdue`, link);
      }
      await query(`UPDATE subtasks SET due_alert_sent = ? WHERE id = ?`, [overdue ? 2 : 1, s.id]);
      subtaskAlerts++;
    }

    return json({ ok: true, dueSoon: dueSoonCount, overdue: overdueCount, subtasks: subtaskAlerts });
  } catch (err) {
    return errorResponse(err);
  }
}
