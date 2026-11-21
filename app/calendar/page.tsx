import { requirePageUser } from "@/lib/page-guard";
import { query, DbRow } from "@/lib/db";
import AppShell from "@/components/AppShell";
import { PageHeader } from "@/components/Cards";
import CalendarView, { type CalEvent } from "@/components/CalendarView";
import CalendarConnectButton from "@/components/CalendarConnectButton";
import { appBaseUrl, mailerConfigured } from "@/lib/mailer";
import { calendarFeedUrl } from "@/lib/calendar-links";
import { istDateKey, istTime24 } from "@/lib/tz";
import { formatRelative } from "@/lib/format";
import { parseUtc } from "@/lib/ics";
import { upcomingCopies } from "@/lib/recurring";
import AutoRefresh from "@/components/work/AutoRefresh";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const user = await requirePageUser();
  const isAdmin = user.role === "admin";

  // Tasks with a due date (scoped: admin=all; else assigned-to-me or in-my-projects)
  const taskRows = await query<DbRow[]>(
    isAdmin
      ? `SELECT t.id, t.title, t.due_date, t.status, t.project_id, p.name AS project_name, t.recurring_task_id
           FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE t.due_date IS NOT NULL`
      : `SELECT t.id, t.title, t.due_date, t.status, t.project_id, p.name AS project_name, t.recurring_task_id
           FROM tasks t JOIN projects p ON p.id = t.project_id
          WHERE t.due_date IS NOT NULL
            AND (t.assignee_id = ? OR t.project_id IN (
              SELECT project_id FROM project_members WHERE user_id = ?
            ))`,
    isAdmin ? [] : [user.id, user.id]
  );

  // My own subtasks: where most people's work is. (An admin's calendar has
  // every task already; everyone's subtasks as well would bury it.)
  const subtaskRows = await query<DbRow[]>(
    `SELECT s.id, s.title, COALESCE(s.due_date, t.due_date) AS due_date, s.status, s.task_id,
            t.title AS task_title, t.project_id, p.name AS project_name
       FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
      WHERE s.assignee_id = ? AND s.status <> 'cancelled' AND COALESCE(s.due_date, t.due_date) IS NOT NULL`,
    [user.id]
  );

  // Milestones and project deadlines, for the projects this person is on.
  const mine = isAdmin ? "" : "AND p.id IN (SELECT project_id FROM project_members WHERE user_id = ? UNION SELECT id FROM projects WHERE owner_id = ?)";
  const mineParams = isAdmin ? [] : [user.id, user.id];
  const milestoneRows = await query<DbRow[]>(
    `SELECT m.id, m.name, m.due_date, m.is_done, m.project_id, p.name AS project_name
       FROM milestones m JOIN projects p ON p.id = m.project_id
      WHERE m.due_date IS NOT NULL AND p.approval_status = 'approved' ${mine}`,
    mineParams
  );
  const deadlineRows = await query<DbRow[]>(
    `SELECT p.id, p.name, p.due_date, p.status FROM projects p
      WHERE p.due_date IS NOT NULL AND p.approval_status = 'approved' ${mine}`,
    mineParams
  );
  // Recurring copies still to come.
  const comingCopies = await upcomingCopies(user);

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

  // The private feed link for subscribing in Google / Outlook / Apple.
  const [me] = await query<DbRow[]>(
    `SELECT calendar_token, calendar_feed_fetched_at FROM users WHERE id = ?`,
    [user.id]
  );
  const calendarUrl = me?.calendar_token
    ? calendarFeedUrl(appBaseUrl(), String(me.calendar_token))
    : null;
  // Rendered here rather than in the client component: a relative time
  // computed on both sides would not match and React would complain.
  const lastFetchedLabel = me?.calendar_feed_fetched_at
    ? formatRelative(parseUtc(String(me.calendar_feed_fetched_at)))
    : null;

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
      label: t.recurring_task_id ? "Recurring task" : "Task",
      title: `${t.recurring_task_id ? "↻ " : ""}${t.title as string}`,
      date: String(t.due_date).slice(0, 10),
      time: null,
      status: t.status as CalEvent["status"],
      projectId: t.project_id as number | null,
      projectName: (t.project_name as string) ?? null,
      href: `/projects/${t.project_id}/tasks/${t.id}`,
    })),
    ...subtaskRows.map((s) => ({
      id: `subtask-${s.id}`,
      kind: "subtask" as const,
      label: "My subtask",
      title: `${s.title as string} — ${s.task_title as string}`,
      date: String(s.due_date).slice(0, 10),
      time: null,
      // A subtask in review is the task's "review"; a cancelled one isn't listed.
      status: s.status as CalEvent["status"],
      projectId: s.project_id as number | null,
      projectName: (s.project_name as string) ?? null,
      href: `/projects/${s.project_id}/tasks/${s.task_id}?subtask=${s.id}`,
    })),
    ...comingCopies.map((c) => ({
      id: `recurring-${c.ruleId}-${c.date}`,
      kind: "recurring" as const,
      label: "Recurring — still to come",
      title: `↻ ${c.title}`,
      date: c.date,
      time: null,
      projectId: c.projectId,
      projectName: c.projectName,
      href: `/recurring?rule=${c.ruleId}`,
    })),
    ...milestoneRows.map((m) => ({
      id: `milestone-${m.id}`,
      kind: "milestone" as const,
      label: m.is_done ? "Milestone — reached" : "Milestone",
      title: `◆ ${m.name as string}`,
      date: String(m.due_date).slice(0, 10),
      time: null,
      projectId: m.project_id as number | null,
      projectName: (m.project_name as string) ?? null,
      href: `/projects/${m.project_id}`,
    })),
    ...deadlineRows.map((p) => ({
      id: `deadline-${p.id}`,
      kind: "deadline" as const,
      label: p.status === "completed" ? "Project deadline — completed" : "Project deadline",
      title: `⚑ ${p.name as string} is due`,
      date: String(p.due_date).slice(0, 10),
      time: null,
      projectId: p.id as number,
      projectName: null,
      href: `/projects/${p.id}`,
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
        subtitle="Tasks, your subtasks, recurring work, milestones, deadlines, meetings and reminders in one place."
        action={
          <CalendarConnectButton
            initialUrl={calendarUrl}
            lastFetchedLabel={lastFetchedLabel}
            meetingsByEmail={mailerConfigured()}
          />
        }
      />
      <AutoRefresh seconds={120} />
      <CalendarView events={events} />
    </AppShell>
  );
}
