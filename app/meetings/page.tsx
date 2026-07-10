import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import MeetingsView from "@/components/MeetingsView";
import type { Meeting } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const user = await requirePageUser();
  const isAdmin = user.role === "admin";

  const where: string[] = [];
  const params: unknown[] = [];
  if (!isAdmin) {
    where.push(`(m.created_by = ? OR m.id IN (
      SELECT meeting_id FROM meeting_attendees WHERE user_id = ?
    ))`);
    params.push(user.id, user.id);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await query<DbRow[]>(
    `SELECT m.id, m.title, m.description, m.project_id, m.location,
            m.start_time, m.reminder_minutes, m.created_by, m.created_at,
            p.name AS project_name, u.name AS creator_name
       FROM meetings m
       LEFT JOIN projects p ON p.id = m.project_id
       LEFT JOIN users u ON u.id = m.created_by
       ${whereSql}
      ORDER BY m.start_time ASC`,
    params
  );

  if (rows.length) {
    const ids = rows.map((m) => m.id as number);
    const ph = ids.map(() => "?").join(",");
    const att = await query<DbRow[]>(
      `SELECT ma.meeting_id, u.id AS user_id, u.name, u.email
         FROM meeting_attendees ma JOIN users u ON u.id = ma.user_id
        WHERE ma.meeting_id IN (${ph}) ORDER BY u.name`,
      ids
    );
    const byMeeting = new Map<
      number,
      { user_id: number; name: string; email: string | null }[]
    >();
    for (const r of att) {
      const arr = byMeeting.get(r.meeting_id) ?? [];
      arr.push({ user_id: r.user_id, name: r.name, email: r.email });
      byMeeting.set(r.meeting_id, arr);
    }
    for (const m of rows) m.attendees = byMeeting.get(m.id as number) ?? [];
  }

  const users = await query<DbRow[]>(
    `SELECT id, name, email FROM users WHERE is_active = TRUE ORDER BY name`
  );
  const projects = await query<DbRow[]>(
    isAdmin
      ? `SELECT id, name FROM projects ORDER BY name`
      : `SELECT p.id, p.name FROM projects p
           JOIN project_members pm ON pm.project_id = p.id
          WHERE pm.user_id = ? ORDER BY p.name`,
    isAdmin ? [] : [user.id]
  );

  return (
    <AppShell user={user}>
      <PageHeader
        title="Meetings"
        subtitle="Schedule meetings and set reminders — attendees are notified in-app and by email."
      />
      <MeetingsView
        initial={rows as unknown as Meeting[]}
        users={users.map((u) => ({ id: u.id, name: u.name, email: u.email }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        currentUser={{ id: user.id, role: user.role }}
      />
    </AppShell>
  );
}
