import { NextRequest } from "next/server";
import { query, DbRow } from "@/lib/db";
import { buildIcs, icsResponse, parseUtc, type IcsEvent } from "@/lib/ics";
import { appBaseUrl } from "@/lib/mailer";
import { checkRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** How far back the feed reaches, so calendars stay small but keep context. */
const PAST_DAYS = 60;

/**
 * GET /api/calendar/feed/:token — one person's meetings, task due dates and
 * reminders as an iCalendar feed, for subscribing in Google Calendar, Outlook
 * or Apple Calendar.
 *
 * The token in the URL is the credential (calendar apps send no cookies), so
 * it is unguessable, per-user and can be reset from the profile page. The feed
 * is read-only and exposes nothing beyond what that person already sees.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  // Calendars poll every few hours; this only stops a client (or a scanner)
  // hammering an endpoint that needs no session.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = checkRateLimit(`calendar-feed:${ip}`, 60);
  if (!limit.ok) {
    return new Response("Too many requests", {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfter ?? 60) },
    });
  }

  // Links are handed out ending in ".ics" because calendar apps look at the
  // extension; older links without it keep working.
  const { token: rawToken } = await params;
  const token = rawToken.replace(/\.ics$/i, "");
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return new Response("Not found", { status: 404 });
  }

  const [user] = await query<DbRow[]>(
    `SELECT id, name FROM users WHERE calendar_token = ? AND is_active = TRUE LIMIT 1`,
    [token]
  );
  if (!user) return new Response("Not found", { status: 404 });

  const base = appBaseUrl();
  const userId = user.id as number;
  const events: IcsEvent[] = [];

  const meetings = await query<DbRow[]>(
    `SELECT m.id, m.title, m.description, m.location, m.video_url, m.start_time,
            m.duration_minutes, m.reminder_minutes, p.name AS project_name
       FROM meetings m
       LEFT JOIN projects p ON p.id = m.project_id
      WHERE (m.created_by = ? OR m.id IN (SELECT meeting_id FROM meeting_attendees WHERE user_id = ?))
        AND m.start_time >= UTC_TIMESTAMP() - INTERVAL ? DAY
      ORDER BY m.start_time
      LIMIT 500`,
    [userId, userId, PAST_DAYS]
  );
  for (const m of meetings) {
    const start = parseUtc(String(m.start_time));
    const details = [
      m.description ? String(m.description) : null,
      m.project_name ? `Project: ${m.project_name}` : null,
      m.video_url ? `Join: ${m.video_url}` : null,
      `${base}/meetings`,
    ].filter(Boolean) as string[];
    events.push({
      uid: `meeting-${m.id}@pmapp`,
      summary: String(m.title),
      start,
      end: new Date(start.getTime() + Number(m.duration_minutes ?? 30) * 60_000),
      description: details.join("\n"),
      location: (m.video_url as string) ?? (m.location as string) ?? null,
      url: (m.video_url as string) ?? `${base}/meetings`,
      alarmMinutesBefore: m.reminder_minutes as number | null,
    });
  }

  // Task due dates as all-day entries (open work only).
  const tasks = await query<DbRow[]>(
    `SELECT t.id, t.title, t.status, t.due_date, t.project_id, p.name AS project_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? AND t.due_date IS NOT NULL AND t.signed_off_at IS NULL
        AND p.approval_status = 'approved' AND p.status <> 'archived'
        AND t.due_date >= UTC_DATE() - INTERVAL ? DAY
      ORDER BY t.due_date
      LIMIT 500`,
    [userId, PAST_DAYS]
  );
  for (const t of tasks) {
    events.push({
      uid: `task-${t.id}@pmapp`,
      summary: `Due: ${t.title}`,
      date: String(t.due_date).slice(0, 10),
      description: `${t.project_name} · ${t.status}\n${base}/projects/${t.project_id}`,
      url: `${base}/projects/${t.project_id}`,
    });
  }

  const reminders = await query<DbRow[]>(
    `SELECT id, title, category, notes, scheduled_at, reminder_minutes
       FROM reminders
      WHERE user_id = ? AND is_done = 0 AND scheduled_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
      ORDER BY scheduled_at
      LIMIT 500`,
    [userId, PAST_DAYS]
  );
  for (const r of reminders) {
    const start = parseUtc(String(r.scheduled_at));
    events.push({
      uid: `reminder-${r.id}@pmapp`,
      summary: String(r.title),
      start,
      end: new Date(start.getTime() + 15 * 60_000),
      description: [r.notes ? String(r.notes) : null, `${base}/reminders`].filter(Boolean).join("\n"),
      url: `${base}/reminders`,
      alarmMinutesBefore: r.reminder_minutes as number | null,
    });
  }

  return icsResponse(
    "pmapp.ics",
    buildIcs(events, { name: `PMApp — ${user.name}`, ttlMinutes: 60 }),
    false
  );
}
