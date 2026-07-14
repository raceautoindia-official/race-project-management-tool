import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError, forbidden } from "@/lib/http";
import { updateReminderSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

function toMysql(v: string): string {
  let s = v.replace("T", " ").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ":00";
  return s.slice(0, 19);
}

async function loadOwned(msId: number, userId: number): Promise<DbRow> {
  const rows = await query<DbRow[]>(
    `SELECT id, user_id FROM reminders WHERE id = ? LIMIT 1`,
    [msId]
  );
  if (!rows.length) throw new ApiError(404, "Reminder not found");
  if (rows[0].user_id !== userId) throw forbidden("Not your reminder");
  return rows[0];
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const rId = Number(id);
    if (!Number.isInteger(rId)) throw new ApiError(400, "Invalid id");
    await loadOwned(rId, user.id);

    const data = updateReminderSchema.parse(await req.json().catch(() => ({})));
    const sets: string[] = [];
    const values: unknown[] = [];
    const map: [string, unknown][] = [];
    if (data.title !== undefined) map.push(["title = ?", data.title]);
    if (data.category !== undefined) map.push(["category = ?", data.category]);
    if (data.notes !== undefined) map.push(["notes = ?", data.notes ?? null]);
    if (data.scheduledAt !== undefined) {
      // Re-arm the reminder when its time changes.
      map.push(["scheduled_at = ?", toMysql(data.scheduledAt)]);
      map.push(["reminder_sent = 0", undefined]);
    }
    if (data.reminderMinutes !== undefined)
      map.push(["reminder_minutes = ?", data.reminderMinutes]);
    if (data.recurrence !== undefined) map.push(["recurrence = ?", data.recurrence]);
    if (data.notifyEmail !== undefined)
      map.push(["notify_email = ?", data.notifyEmail ? 1 : 0]);
    if (data.notifyPush !== undefined)
      map.push(["notify_push = ?", data.notifyPush ? 1 : 0]);
    if (data.isDone !== undefined) map.push(["is_done = ?", data.isDone ? 1 : 0]);

    for (const [frag, val] of map) {
      sets.push(frag);
      if (val !== undefined) values.push(val);
    }
    if (sets.length) {
      values.push(rId);
      await query(`UPDATE reminders SET ${sets.join(", ")} WHERE id = ?`, values);
    }

    const [row] = await query<DbRow[]>(
      `SELECT id, user_id, title, category, notes, scheduled_at, reminder_minutes,
              recurrence, notify_email, notify_push, is_done
         FROM reminders WHERE id = ?`,
      [rId]
    );
    return json({
      reminder: {
        ...row,
        notify_email: Boolean(row.notify_email),
        notify_push: Boolean(row.notify_push),
        is_done: Boolean(row.is_done),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const rId = Number(id);
    if (!Number.isInteger(rId)) throw new ApiError(400, "Invalid id");
    await loadOwned(rId, user.id);
    await query(`DELETE FROM reminders WHERE id = ?`, [rId]);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
