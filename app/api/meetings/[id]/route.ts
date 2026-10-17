import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { logActivity } from "@/lib/activity";
import { sendMeetingInvite } from "@/lib/meeting-invite";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/meetings/:id — the creator or an admin may cancel a meeting. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const meetingId = Number(id);
    if (!Number.isInteger(meetingId)) throw new ApiError(400, "Invalid id");

    const rows = await query<DbRow[]>(
      `SELECT m.id, m.title, m.description, m.location, m.video_url, m.start_time,
              m.duration_minutes, m.reminder_minutes, m.created_by,
              p.name AS project_name, u.name AS organizer_name, u.email AS organizer_email
         FROM meetings m
         LEFT JOIN projects p ON p.id = m.project_id
         LEFT JOIN users u ON u.id = m.created_by
        WHERE m.id = ? LIMIT 1`,
      [meetingId]
    );
    const meeting = rows[0];
    if (!meeting) throw new ApiError(404, "Meeting not found");

    if (user.role !== "admin" && meeting.created_by !== user.id) {
      throw forbidden("Only the organizer or an admin can cancel this meeting");
    }

    // Read the guest list while the rows still exist: deleting the meeting
    // takes the attendee rows with it.
    const guests = await query<DbRow[]>(
      `SELECT u.name, u.email FROM meeting_attendees ma
         JOIN users u ON u.id = ma.user_id
        WHERE ma.meeting_id = ? AND ma.user_id <> ?`,
      [meetingId, meeting.created_by]
    );

    await query(`DELETE FROM meetings WHERE id = ?`, [meetingId]);

    // Withdraw it from their calendars too — a cancellation they never see is
    // worse than no invitation at all. Never fails the delete.
    try {
      await sendMeetingInvite(
        {
          id: meetingId,
          title: String(meeting.title),
          description: (meeting.description as string) ?? null,
          startTime: String(meeting.start_time),
          durationMinutes: (meeting.duration_minutes as number) ?? 30,
          location: (meeting.location as string) ?? null,
          videoUrl: (meeting.video_url as string) ?? null,
          reminderMinutes: (meeting.reminder_minutes as number) ?? null,
          projectName: (meeting.project_name as string) ?? null,
        },
        {
          name: String(meeting.organizer_name ?? user.name),
          email: String(meeting.organizer_email ?? ""),
        },
        guests.map((g) => ({ name: String(g.name), email: String(g.email ?? "") })),
        "CANCEL"
      );
    } catch (err) {
      console.error("[meetings] cancellation failed:", (err as Error).message);
    }
    await logActivity({
      userId: user.id,
      action: "meeting.deleted",
      entityType: "meeting",
      entityId: meetingId,
      metadata: { title: meeting.title },
    });

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
