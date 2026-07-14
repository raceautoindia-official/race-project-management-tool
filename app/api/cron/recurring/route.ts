import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { json, errorResponse } from "@/lib/http";
import { assertCron } from "@/lib/cron";
import { notify } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** Advance a "YYYY-MM-DD" date to the next occurrence strictly after today (UTC). */
function nextDate(dateStr: string, recurrence: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const todayUtc = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const step = () => {
    if (recurrence === "daily") d.setUTCDate(d.getUTCDate() + 1);
    else if (recurrence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
    else if (recurrence === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  };
  do {
    step();
  } while (d.getTime() <= todayUtc.getTime());
  return d.toISOString().slice(0, 10);
}

/** Advance a UTC datetime "YYYY-MM-DD HH:MM:SS" to the next future occurrence. */
function nextDateTime(utc: string, recurrence: string): string {
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
 * POST /api/cron/recurring  (header: x-cron-secret)
 *
 * Materializes recurring work: (1) due recurring-task definitions become real
 * tasks and advance to their next run; (2) recurring meetings whose latest
 * occurrence has passed get their next occurrence created (attendees copied).
 * Run daily (tasks are date-granular; meetings advance on the same pass).
 */
export async function POST(req: NextRequest) {
  try {
    assertCron(req);
    let tasksCreated = 0;
    let meetingsCreated = 0;

    // ── recurring tasks ─────────────────────────────────────────────────────
    const dueRt = await query<DbRow[]>(
      `SELECT id, project_id, title, description, priority, assignee_id,
              estimated_hours, recurrence, next_run, created_by
         FROM recurring_tasks
        WHERE is_active = 1 AND next_run <= UTC_DATE()`
    );
    for (const rt of dueRt) {
      const runDate = String(rt.next_run).slice(0, 10);
      const result = (await query<DbResult>(
        `INSERT INTO tasks
           (project_id, title, description, status, priority, estimated_hours,
            assignee_id, created_by, due_date, start_date)
         VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)`,
        [
          rt.project_id,
          rt.title,
          rt.description ?? null,
          rt.priority,
          rt.estimated_hours ?? null,
          rt.assignee_id ?? null,
          rt.created_by ?? null,
          runDate,
          runDate,
        ]
      )) as unknown as DbResult;

      await query(`UPDATE recurring_tasks SET next_run = ? WHERE id = ?`, [
        nextDate(runDate, rt.recurrence),
        rt.id,
      ]);

      if (rt.assignee_id) {
        await notify(
          rt.assignee_id,
          "task_assigned",
          `Recurring task created: "${rt.title}"`,
          `/projects/${rt.project_id}`
        );
      }
      void result;
      tasksCreated++;
    }

    // ── recurring meetings (advance the latest occurrence once it has passed) ─
    const heads = await query<DbRow[]>(
      `SELECT m.id, m.title, m.description, m.project_id, m.location,
              m.start_time, m.reminder_minutes, m.recurrence, m.series_id, m.created_by
         FROM meetings m
        WHERE m.series_id IS NOT NULL
          AND m.recurrence <> 'none'
          AND m.start_time < UTC_TIMESTAMP()
          AND m.start_time = (
            SELECT MAX(m2.start_time) FROM meetings m2 WHERE m2.series_id = m.series_id
          )`
    );
    for (const h of heads) {
      const nextStart = nextDateTime(String(h.start_time), h.recurrence);
      const res = (await query<DbResult>(
        `INSERT INTO meetings
           (title, description, project_id, location, start_time, reminder_minutes,
            recurrence, series_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          h.title,
          h.description ?? null,
          h.project_id ?? null,
          h.location ?? null,
          nextStart,
          h.reminder_minutes ?? null,
          h.recurrence,
          h.series_id,
          h.created_by ?? null,
        ]
      )) as unknown as DbResult;
      // Copy attendees to the new occurrence.
      await query(
        `INSERT IGNORE INTO meeting_attendees (meeting_id, user_id)
         SELECT ?, user_id FROM meeting_attendees WHERE meeting_id = ?`,
        [res.insertId, h.id]
      );
      meetingsCreated++;
    }

    return json({ ok: true, tasksCreated, meetingsCreated });
  } catch (err) {
    return errorResponse(err);
  }
}
