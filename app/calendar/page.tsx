import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import CalendarView, { type CalEvent } from "@/components/CalendarView";
import { istDateKey, istTime24 } from "@/lib/tz";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const user = await requirePageUser();
  const isAdmin = user.role === "admin";

  // Tasks with a due date (scoped: admin=all; else assigned-to-me or in-my-projects)
  const taskRows = await query<DbRow[]>(
    isAdmin
      ? `SELECT t.id, t.title, t.due_date, t.status, t.project_id, p.name AS project_name
           FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE t.due_date IS NOT NULL`
      : `SELECT t.id, t.title, t.due_date, t.status, t.project_id, p.name AS project_name
           FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE t.due_date IS NOT NULL
            AND (t.assignee_id = ? OR t.project_id IN (
              SELECT project_id FROM project_members WHERE user_id = ?
            ))`,
    isAdmin ? [] : [user.id, user.id]
  );

  // Meetings (scoped: admin=all; else organized-by or attending)
  const meetingRows = await query<DbRow[]>(
    isAdmin
      ? `SELECT m.id, m.title, m.start_time, m.location, m.project_id, p.name AS project_name
           FROM meetings m LEFT JOIN projects p ON p.id = m.project_id`
      : `SELECT m.id, m.title, m.start_time, m.location, m.project_id, p.name AS project_name
           FROM meetings m LEFT JOIN projects p ON p.id = m.project_id
          WHERE m.created_by = ? OR m.id IN (
            SELECT meeting_id FROM meeting_attendees WHERE user_id = ?
          )`,
    isAdmin ? [] : [user.id, user.id]
  );

  // Personal reminders (not done) belonging to this user.
  const reminderRows = await query<DbRow[]>(
    `SELECT id, title, category, scheduled_at FROM reminders
      WHERE user_id = ? AND is_done = 0`,
    [user.id]
  );

  const events: CalEvent[] = [
    ...reminderRows.map((r) => ({
      id: `reminder-${r.id}`,
      kind: "reminder" as const,
      title: r.title as string,
      date: istDateKey(String(r.scheduled_at)),
      time: istTime24(String(r.scheduled_at)) || null,
      category: (r.category as string) ?? "general",
      href: `/reminders`,
    })),
    ...taskRows.map((t) => ({
      id: `task-${t.id}`,
      kind: "task" as const,
      title: t.title as string,
      date: String(t.due_date).slice(0, 10),
      time: null,
      status: t.status as CalEvent["status"],
      projectId: t.project_id as number | null,
      projectName: (t.project_name as string) ?? null,
      href: `/projects/${t.project_id}`,
    })),
    ...meetingRows.map((m) => ({
      id: `meeting-${m.id}`,
      kind: "meeting" as const,
      title: m.title as string,
      date: istDateKey(String(m.start_time)),
      time: istTime24(String(m.start_time)) || null,
      location: (m.location as string) ?? null,
      projectId: m.project_id as number | null,
      projectName: (m.project_name as string) ?? null,
      href: `/meetings`,
    })),
  ];

  return (
    <AppShell user={user}>
      <PageHeader
        title="Calendar"
        subtitle="Your tasks and meetings in one place — switch between month and agenda views."
      />
      <CalendarView events={events} />
    </AppShell>
  );
}
