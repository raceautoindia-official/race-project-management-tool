import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, errorResponse } from "@/lib/http";
import { buildIcs, icsResponse, parseUtc } from "@/lib/ics";
import { appBaseUrl } from "@/lib/mailer";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/meetings/:id/ics — this meeting as a downloadable calendar file,
 * for Apple Calendar, Outlook desktop or any other calendar app.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const meetingId = Number(id);
    if (!Number.isInteger(meetingId)) throw new ApiError(400, "Invalid id");

    const [meeting] = await query<DbRow[]>(
      `SELECT m.id, m.title, m.description, m.location, m.video_url, m.start_time,
              m.duration_minutes, m.reminder_minutes, m.created_by,
              p.name AS project_name,
              EXISTS (SELECT 1 FROM meeting_attendees ma
                       WHERE ma.meeting_id = m.id AND ma.user_id = ?) AS invited
         FROM meetings m
         LEFT JOIN projects p ON p.id = m.project_id
        WHERE m.id = ? LIMIT 1`,
      [user.id, meetingId]
    );
    if (!meeting) throw new ApiError(404, "Meeting not found");
    if (user.role !== "admin" && !Number(meeting.invited) && meeting.created_by !== user.id) {
      throw new ApiError(403, "You are not invited to this meeting");
    }

    const base = appBaseUrl();
    const start = parseUtc(String(meeting.start_time));
    const details = [
      meeting.description ? String(meeting.description) : null,
      meeting.project_name ? `Project: ${meeting.project_name}` : null,
      meeting.video_url ? `Join: ${meeting.video_url}` : null,
      `${base}/meetings`,
    ].filter(Boolean) as string[];

    const body = buildIcs([
      {
        uid: `meeting-${meeting.id}@pmapp`,
        summary: String(meeting.title),
        start,
        end: new Date(start.getTime() + Number(meeting.duration_minutes ?? 30) * 60_000),
        description: details.join("\n"),
        location: (meeting.video_url as string) ?? (meeting.location as string) ?? null,
        url: (meeting.video_url as string) ?? `${base}/meetings`,
        alarmMinutesBefore: meeting.reminder_minutes as number | null,
      },
    ]);
    return icsResponse(`meeting-${meeting.id}.ics`, body);
  } catch (err) {
    return errorResponse(err);
  }
}
