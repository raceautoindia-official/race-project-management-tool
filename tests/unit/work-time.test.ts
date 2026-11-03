import { describe, expect, it } from "vitest";
import { clockStateFrom, timerStopAt, type ClockRow } from "@/lib/attendance-clock";
import { buildPersonDay, istDayBounds, teamTotals, type SessionInput } from "@/lib/time-metrics";

/** An attendance row; times are UTC. 09:00 IST = 03:30 UTC. */
function row(over: Partial<ClockRow> = {}): ClockRow {
  return {
    employee_id: 7,
    work_date: "2026-10-31",
    first_clock_in_utc: "2026-10-31 03:30:00",
    clock_in_utc: "2026-10-31 03:30:00",
    clock_out_utc: null,
    total_minutes: null,
    banked_minutes: 0,
    session_count: 1,
    status: "present",
    ...over,
  };
}
const at = (utc: string) => new Date(utc.replace(" ", "T") + "Z");

describe("the Attendance clock", () => {
  it("is clocked in from a clock-in with no clock-out, and counts the minutes so far", () => {
    const s = clockStateFrom(row({ banked_minutes: 30 }), at("2026-10-31 05:30:00"));
    expect(s.clockedIn).toBe(true);
    expect(s.minutes).toBe(150); // 2h now + 30m banked from earlier
  });

  it("is clocked out after a clock-out, with the day's total", () => {
    const s = clockStateFrom(row({ clock_out_utc: "2026-10-31 12:30:00", total_minutes: 540 }), at("2026-10-31 13:00:00"));
    expect(s.clockedIn).toBe(false);
    expect(s.minutes).toBe(540);
    expect(s.lastOut).toBe("2026-10-31 12:30:00");
  });

  it("is clocked in again after clocking back in (the old clock-out is earlier)", () => {
    const s = clockStateFrom(
      row({ clock_in_utc: "2026-10-31 08:30:00", clock_out_utc: "2026-10-31 07:30:00", banked_minutes: 240 }),
      at("2026-10-31 09:30:00")
    );
    expect(s.clockedIn).toBe(true);
    expect(s.minutes).toBe(300);
  });

  it("is not clocked in on leave, without a row, or on a stretch left open overnight", () => {
    expect(clockStateFrom(row({ status: "leave" }), at("2026-10-31 05:00:00")).clockedIn).toBe(false);
    expect(clockStateFrom(undefined, at("2026-10-31 05:00:00")).clockedIn).toBe(false);
    expect(clockStateFrom(row(), at("2026-11-01 05:00:00")).clockedIn).toBe(false);
  });
});

describe("where a timer stops", () => {
  const started = "2026-10-31 04:00:00";

  it("keeps running while they stay clocked in", () => {
    expect(timerStopAt([row()], started, at("2026-10-31 06:00:00"))).toBeNull();
  });

  it("stops at the clock-out, not when PM noticed", () => {
    const rows = [row({ clock_out_utc: "2026-10-31 07:15:00", total_minutes: 225 })];
    expect(timerStopAt(rows, started, at("2026-10-31 09:00:00"))).toBe("2026-10-31 07:15:00");
  });

  it("stops at the clock-out even if they clocked back in since", () => {
    const rows = [row({ clock_in_utc: "2026-10-31 08:00:00", clock_out_utc: "2026-10-31 07:15:00" })];
    expect(timerStopAt(rows, started, at("2026-10-31 09:00:00"))).toBe("2026-10-31 07:15:00");
  });

  it("stops by the next clock-in when the clock-out in between was overwritten", () => {
    // Out at 07:15, back at 07:45, out again at 12:00: the row only keeps 12:00.
    const rows = [row({ clock_in_utc: "2026-10-31 07:45:00", clock_out_utc: "2026-10-31 12:00:00" })];
    expect(timerStopAt(rows, started, at("2026-10-31 13:00:00"))).toBe("2026-10-31 07:45:00");
  });

  it("stops at yesterday's clock-out when today has begun", () => {
    const rows = [
      row({ clock_out_utc: "2026-10-31 12:30:00" }),
      row({ work_date: "2026-11-01", first_clock_in_utc: "2026-11-01 03:30:00", clock_in_utc: "2026-11-01 03:30:00" }),
    ];
    expect(timerStopAt(rows, started, at("2026-11-01 04:00:00"))).toBe("2026-10-31 12:30:00");
  });

  it("credits nothing past the start when they are not clocked in at all", () => {
    expect(timerStopAt([], started, at("2026-10-31 06:00:00"))).toBe(started);
  });
});

describe("a person's day", () => {
  const person = { userId: 1, employeeId: 7, name: "Asha" };
  const session = (over: Partial<SessionInput>): SessionInput => ({
    user_id: 1,
    task_id: 10,
    subtask_id: null,
    started_at: "2026-10-31 04:00:00",
    ended_at: "2026-10-31 05:00:00",
    task_title: "Build",
    subtask_title: null,
    project_id: 3,
    project_name: "Site",
    ...over,
  });

  it("puts clocked-in time, time on tasks and idle time side by side", () => {
    const now = at("2026-10-31 08:30:00"); // 14:00 IST, clocked in since 09:00 IST
    const day = buildPersonDay(
      person,
      "2026-10-31",
      [row()],
      [
        session({}),
        session({ subtask_id: 21, subtask_title: "Header", started_at: "2026-10-31 05:30:00", ended_at: "2026-10-31 06:30:00" }),
        session({ started_at: "2026-10-31 07:30:00", ended_at: null }),
      ],
      15,
      now
    );
    expect(day.clockedMinutes).toBe(300);
    expect(day.trackedMinutes).toBe(180);
    expect(day.idleMinutes).toBe(120);
    expect(day.utilisation).toBeCloseTo(0.6);
    expect(day.firstStartDelay).toBe(30);
    expect(day.stretches).toBe(3);
    expect(day.switches).toBe(2);
    expect(day.longestStretch).toBe(60);
    expect(day.manualMinutes).toBe(15);
    expect(day.state).toBe("working");
    expect(day.running?.taskId).toBe(10);
    expect(day.items.map((i) => [i.taskId, i.subtaskId, i.minutes])).toEqual([
      [10, null, 120],
      [10, 21, 60],
    ]);
  });

  it("is idle while clocked in with no timer, and not in without a clock-in", () => {
    const now = at("2026-10-31 06:00:00");
    expect(buildPersonDay(person, "2026-10-31", [row()], [], 0, now).state).toBe("idle");
    expect(buildPersonDay(person, "2026-10-31", [], [], 0, now).state).toBe("not_in");
  });

  it("does not count yesterday's hours as today's before they clock in", () => {
    const yesterday = row({ work_date: "2026-10-30", clock_out_utc: "2026-10-30 12:30:00", total_minutes: 540 });
    const day = buildPersonDay(person, "2026-10-31", [yesterday], [], 0, at("2026-10-31 03:00:00"));
    expect(day.clockedMinutes).toBe(0);
    expect(day.state).toBe("not_in");
  });

  it("clips a stretch to the day it is reported on", () => {
    const { start } = istDayBounds("2026-10-31");
    expect(start.toISOString()).toBe("2026-10-30T18:30:00.000Z");
    const day = buildPersonDay(
      person,
      "2026-10-31",
      [],
      [session({ started_at: "2026-10-30 18:00:00", ended_at: "2026-10-30 19:00:00" })],
      0,
      at("2026-10-31 12:00:00")
    );
    expect(day.trackedMinutes).toBe(30);
  });

  it("adds up a team", () => {
    const now = at("2026-10-31 06:00:00");
    const a = buildPersonDay(person, "2026-10-31", [row()], [session({ ended_at: null })], 0, now);
    const b = buildPersonDay({ ...person, userId: 2, employeeId: 8 }, "2026-10-31", [row({ employee_id: 8 })], [], 0, now);
    const t = teamTotals([a, b]);
    expect(t.clockedInNow).toBe(2);
    expect(t.workingNow).toBe(1);
    expect(t.idleNow).toBe(1);
    expect(t.trackedMinutes).toBe(120);
    expect(t.clockedMinutes).toBe(300);
  });
});
