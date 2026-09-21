import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { assertProjectAccess } from "@/lib/rbac";
import { createMeetingSchema } from "@/lib/validation";
import { logActivity, notify } from "@/lib/activity";
import {
  createRemoteMeeting,
  isSafeVideoUrl,
  meetingRoomUrl,
  meetingsApiConfigured,
  newRoomId,
} from "@/lib/video";
import { sendMeetingInvite } from "@/lib/meeting-invite";

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

export async function GET() {
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
              m.video_url, m.video_room_id, m.duration_minutes,
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
    // You can only attach a meeting to a project you can see.
    if (data.projectId) await assertProjectAccess(user, data.projectId);
    const invited = [...new Set(data.attendeeIds ?? [])].filter((id) => id !== user.id);
    if (invited.length) {
      const [found] = await query<DbRow[]>(
        `SELECT COUNT(*) AS n FROM users WHERE is_active = TRUE AND id IN (${invited.map(() => "?").join(",")})`,
        invited
      );
      if (Number(found.n) !== invited.length) {
        throw new ApiError(400, "Every attendee must be an active user");
      }
    }

    // Attendees: the chosen users plus the organizer, de-duplicated.
    const attendeeSet = new Set<number>(data.attendeeIds ?? []);
    attendeeSet.add(user.id);

    // Video call: a room in the company meetings app, a link the organizer
    // already has (Zoom/Meet/Teams), or none.
    let videoRoomId: string | null = null;
    let videoUrl: string | null = null;
    let videoWarning: string | null = null;
    if (data.video === "room") {
      const people = await query<DbRow[]>(
        `SELECT id, name, email FROM users WHERE id IN (${[...attendeeSet].map(() => "?").join(",")})`,
        [...attendeeSet]
      );
      const host = people.find((p) => p.id === user.id);
      // Schedule it in the meetings app itself, so it shows up there with its
      // host and invitees. If that isn't configured (or is unreachable), fall
      // back to a plain room link — the room is created on first join.
      const remote = await createRemoteMeeting({
        title: data.title,
        scheduledAt: toMysqlDateTime(data.startTime),
        durationMins: data.durationMinutes ?? 30,
        host: { name: String(host?.name ?? user.name), email: (host?.email as string) ?? null },
        invitees: people
          .filter((p) => p.id !== user.id)
          .map((p) => ({ name: String(p.name), email: (p.email as string) ?? null })),
      });
      if (remote) {
        videoRoomId = remote.roomId;
        videoUrl = remote.joinUrl;
      } else {
        videoRoomId = newRoomId(data.title);
        videoUrl = meetingRoomUrl(videoRoomId);
        if (meetingsApiConfigured()) {
          videoWarning = host?.email
            ? "The meetings app couldn't be reached, so the room link was created without scheduling it there."
            : "Your profile has no email address, so the meeting couldn't be scheduled in the meetings app — the room link still works.";
        }
      }
    } else if (data.video === "link") {
      const link = (data.videoUrl ?? "").trim();
      if (!link || !isSafeVideoUrl(link)) {
        throw new ApiError(400, "Enter a valid meeting link (https://…)");
      }
      videoUrl = link;
    }

    const result = (await query<DbResult>(
      `INSERT INTO meetings
         (title, description, project_id, location, video_url, video_room_id,
          start_time, duration_minutes, reminder_minutes, recurrence, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.title,
        data.description ?? null,
        data.projectId ?? null,
        data.location ?? null,
        videoUrl,
        videoRoomId,
        toMysqlDateTime(data.startTime),
        data.durationMinutes ?? 30,
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
          `You were invited to "${data.title}"${videoUrl ? " (video call)" : ""}`,
          `/meetings`
        );
      }
    }

    // And as a real calendar invitation, so it lands in their own calendar
    // without anyone having to subscribe to anything. Failure here must not
    // fail the request — the meeting exists and is visible in the app.
    try {
      const guests = await query<DbRow[]>(
        `SELECT id, name, email FROM users WHERE id IN (${
          [...attendeeSet].map(() => "?").join(",")
        })`,
        [...attendeeSet]
      );
      const host = guests.find((g) => g.id === user.id);
      const [project] = data.projectId
        ? await query<DbRow[]>(`SELECT name FROM projects WHERE id = ?`, [data.projectId])
        : [];
      await sendMeetingInvite(
        {
          id: meetingId,
          title: data.title,
          description: data.description ?? null,
          startTime: toMysqlDateTime(data.startTime),
          durationMinutes: data.durationMinutes ?? 30,
          location: data.location ?? null,
          videoUrl,
          reminderMinutes: data.reminderMinutes ?? null,
          projectName: (project?.name as string) ?? null,
        },
        {
          name: String(host?.name ?? user.name),
          email: String(host?.email ?? user.email ?? ""),
        },
        guests
          .filter((g) => g.id !== user.id)
          .map((g) => ({ name: String(g.name), email: String(g.email ?? "") }))
      );
    } catch (err) {
      console.error("[meetings] invitation failed:", (err as Error).message);
    }

    const rows = await query<DbRow[]>(
      `SELECT m.id, m.title, m.description, m.project_id, m.location,
              m.video_url, m.video_room_id, m.duration_minutes,
              m.start_time, m.reminder_minutes, m.recurrence, m.created_by, m.created_at,
              p.name AS project_name, u.name AS creator_name
         FROM meetings m
         LEFT JOIN projects p ON p.id = m.project_id
         LEFT JOIN users u ON u.id = m.created_by
        WHERE m.id = ?`,
      [meetingId]
    );
    await attachAttendees(rows);
    return json({ meeting: rows[0], videoWarning }, 201);
  } catch (err) {
    return errorResponse(err);
  }
}
