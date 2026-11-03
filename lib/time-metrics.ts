import { clockStateFrom, latestRow, parseUtc, type ClockRow, type ClockState } from "./attendance-clock";

/**
 * lib/time-metrics.ts — a person's working day, from two sources:
 * the Attendance clock (when they were clocked in) and the work timer (what
 * they were working on). Pure: no database, no clock of its own.
 *
 *   clocked   minutes clocked in on Attendance that day (live for today)
 *   on tasks  minutes a work timer was running, within that day
 *   idle      clocked in with no timer running = clocked − on tasks
 *
 * "Idle" is time without a timer, not time without work: meetings, reading,
 * helping a colleague all land there unless someone starts a timer for them.
 * Pages say so next to the number.
 */

export interface SessionInput {
  user_id: number;
  task_id: number;
  subtask_id: number | null;
  started_at: string;
  ended_at: string | null;
  task_title: string;
  subtask_title: string | null;
  project_id: number;
  project_name: string;
}

export interface PersonInput {
  userId: number;
  employeeId: number;
  name: string;
  department?: string | null;
}

export interface ItemTime {
  taskId: number;
  subtaskId: number | null;
  projectId: number;
  projectName: string;
  taskTitle: string;
  subtaskTitle: string | null;
  minutes: number;
  stretches: number;
}

export interface Stretch {
  start: string;
  end: string;
  running: boolean;
  taskId: number;
  subtaskId: number | null;
  projectId: number;
  label: string;
}

export type LiveState = "working" | "idle" | "clocked_out" | "not_in";

export interface PersonDay {
  userId: number;
  name: string;
  department: string | null;
  date: string;
  clock: ClockState;
  clockedMinutes: number;
  trackedMinutes: number;
  idleMinutes: number;
  /** On tasks as a share of clocked, 0–1; null when not clocked in at all. */
  utilisation: number | null;
  /** Minutes typed in by hand that day (not from the timer). */
  manualMinutes: number;
  /** From the first clock-in to the first timer started that day. */
  firstStartDelay: number | null;
  stretches: number;
  /** Times they moved from one piece of work to another. */
  switches: number;
  longestStretch: number;
  items: ItemTime[];
  timeline: Stretch[];
  running: Stretch | null;
  /** Only meaningful for today. */
  state: LiveState;
}

const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;

/** The UTC instants an IST calendar day runs between. */
export function istDayBounds(day: string): { start: Date; end: Date } {
  const start = new Date(new Date(`${day}T00:00:00Z`).getTime() - IST_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / 60_000);
}

function labelOf(s: SessionInput): string {
  return s.subtask_title ? `${s.subtask_title} · ${s.task_title}` : s.task_title;
}

/**
 * One person's day. `rows` are their attendance rows (any days — the one for
 * `day` is picked out); `sessions` their timer sessions overlapping it.
 */
export function buildPersonDay(
  person: PersonInput,
  day: string,
  rows: ClockRow[],
  sessions: SessionInput[],
  manualMinutes: number,
  now: Date
): PersonDay {
  const { start: dayStart, end: dayEnd } = istDayBounds(day);
  const until = now < dayEnd ? now : dayEnd;
  const isToday = now >= dayStart && now < dayEnd;

  // That day's row — or, today, yesterday's if they are still clocked in on
  // it (a night shift's row belongs to the day it began).
  let row = rows.find((r) => r.work_date === day);
  if (isToday && !row) {
    const last = latestRow(rows);
    if (last && clockStateFrom(last, now).clockedIn) row = last;
  }
  const clock = clockStateFrom(row, isToday ? now : dayEnd);
  const atWork = clock.status !== "absent" && clock.status !== "leave" && clock.status !== "holiday";
  const clockedMinutes = atWork ? clock.minutes : 0;

  const timeline: Stretch[] = [];
  const byItem = new Map<string, ItemTime>();
  const sorted = [...sessions].sort((a, b) => a.started_at.localeCompare(b.started_at));
  for (const s of sorted) {
    const a = parseUtc(s.started_at);
    const b = s.ended_at ? parseUtc(s.ended_at) : now;
    const from = a > dayStart ? a : dayStart;
    const to = b < until ? b : until;
    if (to <= from) continue;
    const minutes = minutesBetween(from, to);
    timeline.push({
      start: from.toISOString(),
      end: to.toISOString(),
      running: !s.ended_at,
      taskId: s.task_id,
      subtaskId: s.subtask_id,
      projectId: s.project_id,
      label: labelOf(s),
    });
    const key = `${s.task_id}|${s.subtask_id ?? ""}`;
    const item = byItem.get(key) ?? {
      taskId: s.task_id,
      subtaskId: s.subtask_id,
      projectId: s.project_id,
      projectName: s.project_name,
      taskTitle: s.task_title,
      subtaskTitle: s.subtask_title,
      minutes: 0,
      stretches: 0,
    };
    item.minutes += minutes;
    item.stretches += 1;
    byItem.set(key, item);
  }

  const trackedMinutes = Math.round(timeline.reduce((n, t) => n + minutesBetween(new Date(t.start), new Date(t.end)), 0));
  let switches = 0;
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].taskId !== timeline[i - 1].taskId || timeline[i].subtaskId !== timeline[i - 1].subtaskId) switches++;
  }
  const firstIn = clock.firstIn ? parseUtc(clock.firstIn) : null;
  const firstStart = timeline[0] ? new Date(timeline[0].start) : null;
  const running = timeline.find((t) => t.running) ?? null;

  let state: LiveState = "not_in";
  if (running) state = "working";
  else if (clock.clockedIn) state = "idle";
  else if (clock.firstIn && atWork) state = "clocked_out";

  return {
    userId: person.userId,
    name: person.name,
    department: person.department ?? null,
    date: day,
    clock,
    clockedMinutes,
    trackedMinutes,
    idleMinutes: Math.max(0, clockedMinutes - trackedMinutes),
    utilisation: clockedMinutes > 0 ? Math.min(1, trackedMinutes / clockedMinutes) : null,
    manualMinutes,
    firstStartDelay: firstIn && firstStart && firstStart >= firstIn ? Math.round(minutesBetween(firstIn, firstStart)) : null,
    stretches: timeline.length,
    switches,
    longestStretch: Math.round(timeline.reduce((m, t) => Math.max(m, minutesBetween(new Date(t.start), new Date(t.end))), 0)),
    items: [...byItem.values()]
      .map((i) => ({ ...i, minutes: Math.round(i.minutes) }))
      .sort((a, b) => b.minutes - a.minutes),
    timeline,
    running,
    state,
  };
}

export interface TeamDayTotals {
  people: number;
  clockedInNow: number;
  workingNow: number;
  idleNow: number;
  clockedMinutes: number;
  trackedMinutes: number;
  idleMinutes: number;
  utilisation: number | null;
}

export function teamTotals(days: PersonDay[]): TeamDayTotals {
  const clockedMinutes = days.reduce((n, d) => n + d.clockedMinutes, 0);
  const trackedMinutes = days.reduce((n, d) => n + d.trackedMinutes, 0);
  return {
    people: days.length,
    clockedInNow: days.filter((d) => d.clock.clockedIn).length,
    workingNow: days.filter((d) => d.state === "working").length,
    idleNow: days.filter((d) => d.state === "idle").length,
    clockedMinutes,
    trackedMinutes,
    idleMinutes: days.reduce((n, d) => n + d.idleMinutes, 0),
    utilisation: clockedMinutes > 0 ? Math.min(1, trackedMinutes / clockedMinutes) : null,
  };
}
