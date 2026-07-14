import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";
import { createMeetingSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** "YYYY-MM-DDTHH:mm[:ss]" → "YYYY-MM-DD HH:mm:ss" for MySQL DATETIME. */
function toMysqlDateTime(v: string): string {
  let s = v.replace("T", " ").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ":00";
  return s.slice(0, 19);
}

async function attachAttendees(meetings: DbRow[]): Promise<void> {
  if (meetings.length === 0) return;
  const ids = meetings.map((m) => m.id as number);
  const ph = ids.map(() => "?").join(",");
  const rows = await query<DbRow[]>(
    `SELECT ma.meeting_id, u.id AS user_id, u.name, u.email
       FROM meeting_attendees ma JOIN users u ON u.id = ma.user_id
      WHERE ma.meeting_id IN (${ph}) ORDER BY u.name`,
    ids
  );
  const byMeeting = new Map<
    number,
    { user_id: number; name: string; email: string | null }[]
  >();
  for (const r of rows) {
    const arr = byMeeting.get(r.meeting_id) ?? [];
    arr.push({ user_id: r.user_id, name: r.name, email: r.email });
    byMeeting.set(r.meeting_id, arr);
  }
  for (const m of meetings) m.attendees = byMeeting.get(m.id as number) ?? [];
}

export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();

    const where: string[] = [];
    const params: unknown[] = [];
    if (user.role !== "admin") {
      where.push(`(m.created_by = ? OR m.id IN (
        SELECT meeting_id FROM meeting_attendees WHERE user_id = ?
      ))`);
      params.push(user.id, user.id);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const meetings = await query<DbRow[]>(
      `SELECT m.id, m.title, m.description, m.project_id, m.location,
              m.start_time, m.reminder_minutes, m.recurrence, m.created_by, m.created_at,
              p.name AS project_name, u.name AS creator_name
         FROM meetings m
         LEFT JOIN projects p ON p.id = m.project_id
         LEFT JOIN users u ON u.id = m.created_by
         ${whereSql}
        ORDER BY m.start_time ASC`,
      params
    );
    await attachAttendees(meetings);
    return json({ meetings });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const data = createMeetingSchema.parse(await req.json().catch(() => ({})));

    const result = (await query<DbResult>(
      `INSERT INTO meetings
         (title, description, project_id, location, start_time, reminder_minutes,
          recurrence, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.description ?? null,
        data.projectId ?? null,
        data.location ?? null,
        toMysqlDateTime(data.startTime),
        data.reminderMinutes ?? null,
        data.recurrence ?? "none",
        user.id,
      ]
    )) as unknown as DbResult;
    const meetingId = result.insertId;

    // A recurring meeting is its own series head (used by the cron to advance).
    if (data.recurrence && data.recurrence !== "none") {
      await query(`UPDATE meetings SET series_id = ? WHERE id = ?`, [
        meetingId,
        meetingId,
      ]);
    }

    // Attendees: the chosen users plus the creator, de-duplicated.
    const attendeeSet = new Set<number>(data.attendeeIds ?? []);
    attendeeSet.add(user.id);
    for (const uid of attendeeSet) {
      await query(
        `INSERT IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)`,
        [meetingId, uid]
      );
    }

    await logActivity({
      userId: user.id,
      action: "meeting.created",
      entityType: "meeting",
      entityId: meetingId,
      metadata: { title: data.title, start_time: data.startTime },
    });

    // Let invited attendees know immediately (in-app).
    for (const uid of attendeeSet) {
      if (uid !== user.id) {
        await notify(
          uid,
          "meeting_invite",
          `You were invited to "${data.title}"`,
          `/meetings`
        );
      }
    }

    const rows = await query<DbRow[]>(
      `SELECT m.id, m.title, m.description, m.project_id, m.location,
              m.start_time, m.reminder_minutes, m.recurrence, m.created_by, m.created_at,
              p.name AS project_name, u.name AS creator_name
         FROM meetings m
         LEFT JOIN projects p ON p.id = m.project_id
         LEFT JOIN users u ON u.id = m.created_by
        WHERE m.id = ?`,
      [meetingId]
    );
    await attachAttendees(rows);
    return json({ meeting: rows[0] }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
