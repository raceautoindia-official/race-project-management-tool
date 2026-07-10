import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { logActivity } from "@/lib/activity";

type Params = { params: Promise<{ id: string }> };

/** DELETE /api/meetings/:id — the creator or an admin may cancel a meeting. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const meetingId = Number(id);
    if (!Number.isInteger(meetingId)) throw new ApiError(400, "Invalid id");

    const rows = await query<DbRow[]>(
      `SELECT id, title, created_by FROM meetings WHERE id = ? LIMIT 1`,
      [meetingId]
    );
    const meeting = rows[0];
    if (!meeting) throw new ApiError(404, "Meeting not found");

    if (user.role !== "admin" && meeting.created_by !== user.id) {
      throw forbidden("Only the organizer or an admin can cancel this meeting");
    }

    await query(`DELETE FROM meetings WHERE id = ?`, [meetingId]);
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
