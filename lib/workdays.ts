import "server-only";
import type { RowDataPacket } from "mysql2";
import { attendancePool } from "./attendance";
import { WEEKDAYS, weekdayOf, type IsWorkingDay, type Weekday } from "./recurrence";

/**
 * lib/workdays.ts — who works which days, from WorkLens (the Attendance app):
 *
 * - working days: the person's shift (employee_schedules → shifts.working_days,
 *   e.g. ["Mon",…,"Sat"]) in force on that date;
 * - holidays: holiday_calendar dates the admin has observed
 *   (holiday_observances.is_observed) for every location, or for the location
 *   on the person's schedule.
 *
 * Someone with no schedule works Monday to Saturday. If WorkLens can't be
 * read at all, nothing is skipped (better a copy on a holiday than a copy
 * silently lost) and `unavailable` says so.
 */

export const DEFAULT_WORKING_DAYS: Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface WorkCalendar {
  /** For a PM user's Attendance employee id; null = no owner (company default). */
  isWorkingDay(employeeId: number | null, date: string): boolean;
  /** A holiday's name on that date for this person, if any. */
  holidayName(employeeId: number | null, date: string): string | null;
  unavailable: boolean;
}

interface ScheduleRow {
  employee_id: number;
  location_id: number | null;
  effective_from: string;
  effective_to: string | null;
  working_days: Weekday[];
}

interface HolidayRow {
  date: string;
  name: string;
  /** null = every location. */
  location_id: number | null;
}

function asDays(v: unknown): Weekday[] {
  let list: unknown = v;
  if (typeof v === "string") {
    try {
      list = JSON.parse(v);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list) ? list.filter((d): d is Weekday => (WEEKDAYS as string[]).includes(String(d))) : [];
}

/** Build a calendar from rows already read (also what the tests use). */
export function calendarFrom(schedules: ScheduleRow[], holidays: HolidayRow[], unavailable = false): WorkCalendar {
  const scheduleOn = (employeeId: number | null, date: string) =>
    employeeId == null
      ? undefined
      : schedules.find(
          (s) => s.employee_id === employeeId && s.effective_from <= date && (s.effective_to == null || s.effective_to >= date)
        );
  const holidayFor = (employeeId: number | null, date: string) => {
    if (unavailable) return null;
    const loc = scheduleOn(employeeId, date)?.location_id ?? null;
    return holidays.find((h) => h.date === date && (h.location_id == null || h.location_id === loc)) ?? null;
  };
  return {
    unavailable,
    holidayName: (employeeId, date) => holidayFor(employeeId, date)?.name ?? null,
    isWorkingDay(employeeId, date) {
      if (unavailable) return true;
      const s = scheduleOn(employeeId, date);
      const days = s && s.working_days.length ? s.working_days : DEFAULT_WORKING_DAYS;
      if (!days.includes(weekdayOf(date))) return false;
      return !holidayFor(employeeId, date);
    },
  };
}

/** Read the calendar for these people over [from, to] (India dates). */
export async function loadWorkCalendar(employeeIds: number[], from: string, to: string): Promise<WorkCalendar> {
  try {
    const ids = [...new Set(employeeIds.filter((n) => Number.isInteger(n) && n > 0))];
    const schedules: ScheduleRow[] = [];
    if (ids.length) {
      const [rows] = await attendancePool.query<RowDataPacket[]>(
        `SELECT es.employee_id, es.location_id, es.effective_from, es.effective_to, s.working_days
           FROM employee_schedules es JOIN shifts s ON s.id = es.shift_id
          WHERE es.employee_id IN (${ids.map(() => "?").join(",")})
            AND es.effective_from <= ? AND (es.effective_to IS NULL OR es.effective_to >= ?)`,
        [...ids, to, from]
      );
      for (const r of rows) {
        schedules.push({
          employee_id: Number(r.employee_id),
          location_id: r.location_id == null ? null : Number(r.location_id),
          effective_from: String(r.effective_from).slice(0, 10),
          effective_to: r.effective_to == null ? null : String(r.effective_to).slice(0, 10),
          working_days: asDays(r.working_days),
        });
      }
    }
    const [hrows] = await attendancePool.query<RowDataPacket[]>(
      `SELECT hc.holiday_date, hc.name, ho.location_id
         FROM holiday_calendar hc
         JOIN holiday_observances ho ON ho.holiday_id = hc.id AND ho.is_observed = 1
        WHERE hc.holiday_date BETWEEN ? AND ?`,
      [from, to]
    );
    const holidays = hrows.map((r) => ({
      date: String(r.holiday_date).slice(0, 10),
      name: String(r.name),
      location_id: r.location_id == null ? null : Number(r.location_id),
    }));
    return calendarFrom(schedules, holidays);
  } catch (err) {
    console.warn("[workdays] WorkLens calendar unavailable:", (err as Error).message);
    return calendarFrom([], [], true);
  }
}

/** A calendar for one person as the pure schedule code wants it. */
export function forPerson(cal: WorkCalendar, employeeId: number | null): IsWorkingDay {
  return (date) => cal.isWorkingDay(employeeId, date);
}
