import { NextRequest } from "next/server";
import { query, DbRow, DbResult } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse } from "@/lib/http";
import { createReminderSchema } from "@/lib/validation";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** "YYYY-MM-DDTHH:mm[:ss]" → "YYYY-MM-DD HH:mm:ss". */
function toMysql(v: string): string {
  let s = v.replace("T", " ").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ":00";
  return s.slice(0, 19);
}

/** GET — the current user's reminders. */
export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();
    const rows = await query<DbRow[]>(
      `SELECT id, user_id, title, category, notes, scheduled_at, reminder_minutes,
              recurrence, notify_email, notify_push, is_done
         FROM reminders WHERE user_id = ?
        ORDER BY is_done ASC, scheduled_at ASC`,
      [user.id]
    );
    return json({
      reminders: rows.map((r) => ({
        ...r,
        notify_email: Boolean(r.notify_email),
        notify_push: Boolean(r.notify_push),
        is_done: Boolean(r.is_done),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST — create a reminder for the current user. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const data = createReminderSchema.parse(await req.json().catch(() => ({})));
    const result = (await query<DbResult>(
      `INSERT INTO reminders
         (user_id, title, category, notes, scheduled_at, reminder_minutes,
          recurrence, notify_email, notify_push)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        data.title,
        data.category ?? "general",
        data.notes ?? null,
        toMysql(data.scheduledAt),
        data.reminderMinutes ?? 0,
        data.recurrence ?? "none",
        data.notifyEmail === false ? 0 : 1,
        data.notifyPush === false ? 0 : 1,
      ]
    )) as unknown as DbResult;

    await logActivity({
      userId: user.id,
      action: "reminder.created",
      entityType: "reminder",
      entityId: result.insertId,
      metadata: { title: data.title, category: data.category ?? "general" },
    });

    const [row] = await query<DbRow[]>(
      `SELECT id, user_id, title, category, notes, scheduled_at, reminder_minutes,
              recurrence, notify_email, notify_push, is_done
         FROM reminders WHERE id = ?`,
      [result.insertId]
    );
    return json(
      {
        reminder: {
          ...row,
          notify_email: Boolean(row.notify_email),
          notify_push: Boolean(row.notify_push),
          is_done: Boolean(row.is_done),
        },
      },
      201
    );
  } catch (err) {
    return errorResponse(err);
  }
}
