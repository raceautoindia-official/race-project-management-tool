import "server-only";
import { query, DbRow } from "./db";
import { getTeamPerformance, type MemberStats } from "./performance";
import { getMyWork, type MyWork } from "./my-work";
import { getWorkHours } from "./work-hours-data";
import type { PersonWorkHours } from "./work-hours";
import { dailySummary } from "./daily-summary";
import { weekSummary } from "./week-summary";
import type { DailySummary, WeekSummary } from "./planner-summary-shape";
import { isLocked, updateStatus, weekStart, type UpdateStatus } from "./planner";
import { dailyStatusGrid, submissionRate, trackingSince, type StatusCell } from "./work-updates";
import type { User } from "./types";

/**
 * lib/person-profile.ts — everything about one person that someone
 * accountable for them needs (Team › a person): who they are, what they are
 * working on and holding, how they are doing, their work updates, and what
 * they did lately. The caller checks access (canReadPlanner).
 */

export interface UpdateEntry {
  plan: string | null;
  progress: string | null;
  submitted_at: string | null;
  submission: "manual" | "auto" | null;
  updated_at: string | null;
}

export interface PersonProfile {
  person: DbRow;
  stats: MemberStats | null;
  projects: DbRow[];
  work: MyWork;
  hours: PersonWorkHours | null;
  /** The last 30 days of daily updates, oldest first. */
  days: StatusCell[];
  rate: number | null;
  day: { date: string; status: UpdateStatus; locked: boolean; entry: UpdateEntry | null; recorded: DailySummary };
  week: { start: string; status: UpdateStatus; locked: boolean; entry: UpdateEntry | null; recorded: WeekSummary };
  activity: DbRow[];
}

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function entryFor(userId: number, period: "day" | "week", date: string): Promise<UpdateEntry | null> {
  const [row] = await query<DbRow[]>(
    `SELECT plan, progress, submitted_at, submission, updated_at FROM planner_entries
      WHERE user_id = ? AND period = ? AND entry_date = ? LIMIT 1`,
    [userId, period, date]
  );
  return (row as unknown as UpdateEntry) ?? null;
}

export async function getPersonProfile(
  viewer: User,
  personId: number,
  date: string,
  today: string
): Promise<PersonProfile | null> {
  const [person] = await query<DbRow[]>(
    `SELECT id, emp_id, employee_id, name, email, department, designation, role, is_active, retired_at, retired_reason, last_seen_at
       FROM users WHERE id = ? LIMIT 1`,
    [personId]
  );
  if (!person) return null;

  const { members } = await getTeamPerformance(viewer);
  const stats = members.find((m) => m.id === personId) ?? null;

  const projects = await query<DbRow[]>(
    `SELECT p.id, p.name, p.status, p.approval_status, p.department, pm.role_in_project,
            (p.owner_id = ?) AS is_owner,
            (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.assignee_id = ? AND t.status <> 'done') AS open_tasks
       FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = ?
      ORDER BY (p.status = 'active') DESC, p.name`,
    [personId, personId, personId]
  );

  const work = await getMyWork({
    id: personId,
    name: String(person.name),
    role: person.role === "admin" ? "admin" : "member",
  } as User);

  // Attendance hours this week, when the viewer may see this person's.
  let hours: PersonWorkHours | null = null;
  try {
    const [me] = await query<DbRow[]>(`SELECT employee_id FROM users WHERE id = ?`, [viewer.id]);
    const monday = weekStart(today);
    const report = await getWorkHours(
      { id: viewer.id, employee_id: Number(me?.employee_id ?? 0), role: viewer.role },
      monday,
      shiftDay(monday, 6)
    );
    hours = report.people.find((p) => p.userId === personId) ?? null;
  } catch {
    hours = null;
  }

  const since = await trackingSince();
  const days = (await dailyStatusGrid([personId], shiftDay(today, -29), today, today)).get(personId) ?? [];
  const dayEntry = await entryFor(personId, "day", date);
  const monday = weekStart(date);
  const weekEntry = await entryFor(personId, "week", monday);

  const activity = await query<DbRow[]>(
    `SELECT id, action, entity_type, entity_id, metadata, created_at FROM activity_log
      WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30`,
    [personId]
  );

  return {
    person,
    stats,
    projects,
    work,
    hours,
    days,
    rate: submissionRate(days),
    day: {
      date,
      status: updateStatus("day", date, today, dayEntry, since),
      locked: isLocked("day", date, today),
      entry: dayEntry,
      recorded: await dailySummary(personId, date),
    },
    week: {
      start: monday,
      status: updateStatus("week", monday, today, weekEntry, since),
      locked: isLocked("week", monday, today),
      entry: weekEntry,
      recorded: await weekSummary(personId, monday),
    },
    activity,
  };
}
