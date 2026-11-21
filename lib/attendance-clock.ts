/**
 * lib/attendance-clock.ts — is someone clocked in on the Attendance app, and
 * for how long today?
 *
 * Attendance keeps one row per person per working day (`attendance`):
 *   first_clock_in_utc  the day's first clock-in
 *   clock_in_utc        when the current (or last) stretch began
 *   clock_out_utc       when the last stretch ended — NULL while clocked in,
 *                       or older than clock_in_utc after clocking back in
 *   banked_minutes      earlier stretches of the day, already finished
 *   total_minutes       the day's total, set at clock-out (banked + last)
 *   session_count       how many stretches
 * Forgotten clock-outs are closed by Attendance the next morning. All times
 * are UTC "YYYY-MM-DD HH:MM:SS" strings.
 *
 * The pure part (clockStateFrom) is testable without either database; the
 * reads are read-only like the rest of the Attendance access.
 */

export interface ClockRow {
  employee_id: number;
  work_date: string;
  first_clock_in_utc: string | null;
  clock_in_utc: string | null;
  clock_out_utc: string | null;
  total_minutes: number | null;
  banked_minutes: number | null;
  session_count: number | null;
  status: string | null;
}

export interface ClockState {
  clockedIn: boolean;
  /** When the current stretch began (UTC), while clocked in. */
  since: string | null;
  /** The day's first clock-in (UTC). */
  firstIn: string | null;
  /** The last clock-out (UTC), if they have clocked out since clocking in. */
  lastOut: string | null;
  /** The Attendance working day this row belongs to. */
  workDate: string | null;
  /** Minutes clocked in on that day so far (live while clocked in). */
  minutes: number;
  sessions: number;
  status: string | null;
}

/** A stretch open longer than this is a forgotten clock-out, not work. */
const STALE_HOURS = 20;

export const NOT_CLOCKED_IN: ClockState = {
  clockedIn: false,
  since: null,
  firstIn: null,
  lastOut: null,
  workDate: null,
  minutes: 0,
  sessions: 0,
  status: null,
};

export function parseUtc(s: string): Date {
  return new Date(String(s).replace(" ", "T").replace(/Z?$/, "Z"));
}

/** A Date as the "YYYY-MM-DD HH:MM:SS" UTC string MySQL stores. */
export function toSqlUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

/** What one attendance row says about now. Pure. */
export function clockStateFrom(row: ClockRow | undefined | null, now: Date): ClockState {
  if (!row || !row.clock_in_utc) {
    return row ? { ...NOT_CLOCKED_IN, workDate: String(row.work_date).slice(0, 10), status: row.status } : NOT_CLOCKED_IN;
  }
  const inAt = parseUtc(row.clock_in_utc);
  const outAt = row.clock_out_utc ? parseUtc(row.clock_out_utc) : null;
  const open = !outAt || outAt < inAt;
  const away = row.status === "leave" || row.status === "holiday" || row.status === "absent";
  const stale = now.getTime() - inAt.getTime() > STALE_HOURS * 3600_000;
  const clockedIn = open && !away && !stale && inAt <= now;
  const banked = Number(row.banked_minutes ?? 0);
  const minutes = clockedIn
    ? banked + Math.max(0, Math.floor((now.getTime() - inAt.getTime()) / 60_000))
    : Number(row.total_minutes ?? banked);
  return {
    clockedIn,
    since: clockedIn ? row.clock_in_utc : null,
    firstIn: row.first_clock_in_utc ?? row.clock_in_utc,
    lastOut: open ? null : row.clock_out_utc,
    workDate: String(row.work_date).slice(0, 10),
    minutes,
    sessions: Number(row.session_count ?? 1),
    status: row.status,
  };
}

/**
 * Where a timer started at `startedAt` must stop, given the person's
 * attendance rows from that day on — or null if they have been clocked in
 * the whole time and it keeps running.
 *
 * - A clock-out after the start stops it there. Clocking back in does not
 *   restart it: they press Resume.
 * - A row only remembers its last clock-out, so a clock-in *after* the start
 *   proves they left in between. If the clock-out itself is no longer on the
 *   row (they clocked out again since), the timer stops at that clock-in at
 *   the latest — off by at most the gap between two checks.
 * - They never clocked out (the stretch was left open and went stale, or
 *   the next thing on record is a clock-in on a later day): the timer stops
 *   at midnight, India time, of the day it started — never days later, and
 *   never with the whole day's work thrown away.
 * - Not clocked in at all, or marked away: no time is credited past the
 *   start.
 */
export function timerStopAt(rows: ClockRow[], startedAt: string, now: Date): string | null {
  const start = parseUtc(startedAt);
  const cap = endOfIndiaDay(start);
  let stop: { at: string; left: boolean } | null = null;
  const consider = (at: string, left: boolean) => {
    if (!stop || parseUtc(at) < parseUtc(stop.at)) stop = { at, left };
  };
  for (const r of rows) {
    if (r.clock_out_utc && parseUtc(r.clock_out_utc) >= start) consider(r.clock_out_utc, true);
    if (r.clock_in_utc && parseUtc(r.clock_in_utc) > start) consider(r.clock_in_utc, false);
  }
  if (stop) {
    const found = stop as { at: string; left: boolean };
    // A clock-out is when they left. A later clock-in only proves they left
    // some time before it: past midnight, midnight is the fairer guess.
    return !found.left && parseUtc(found.at) > cap ? toSqlUtc(cap) : found.at;
  }
  const latest = latestRow(rows);
  if (clockStateFrom(latest, now).clockedIn) return null;
  // Left open and gone stale: they worked, then forgot to clock out.
  if (latest?.clock_in_utc && parseUtc(latest.clock_in_utc) <= start) {
    const out = latest.clock_out_utc ? parseUtc(latest.clock_out_utc) : null;
    const away = latest.status === "leave" || latest.status === "holiday" || latest.status === "absent";
    if (!away && (!out || out < parseUtc(latest.clock_in_utc))) return toSqlUtc(cap < now ? cap : now);
  }
  return startedAt;
}

/** Midnight (India time) at the end of the day an instant falls in. */
function endOfIndiaDay(at: Date): Date {
  const IST_MS = 330 * 60_000;
  const DAY_MS = 86_400_000;
  return new Date(Math.floor((at.getTime() + IST_MS) / DAY_MS) * DAY_MS + DAY_MS - IST_MS);
}

/** The row for the most recent working day. */
export function latestRow(rows: ClockRow[]): ClockRow | undefined {
  let best: ClockRow | undefined;
  for (const r of rows) {
    if (!best || String(r.work_date) > String(best.work_date)) best = r;
  }
  return best;
}
