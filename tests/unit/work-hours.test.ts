import { describe, expect, it } from "vitest";
import {
  buildWorkHours,
  dateRange,
  formatMinutes,
  visibleEmployeeIds,
  weekBounds,
  type AttendanceDayInput,
  type LoggedDayInput,
  type PersonRef,
} from "@/lib/work-hours";

const ASHA: PersonRef = { userId: 1, employeeId: 101, name: "Asha", department: "Survey" };
const RAVI: PersonRef = { userId: 2, employeeId: 102, name: "Ravi" };

const day = (
  employee_id: number,
  work_date: string,
  status: AttendanceDayInput["status"],
  total_minutes: number | null
): AttendanceDayInput => ({ employee_id, work_date, status, total_minutes });

const log = (user_id: number, day: string, minutes: number): LoggedDayInput => ({
  user_id,
  day,
  minutes,
});

describe("the working week", () => {
  it("runs Monday to Sunday, whichever day you ask about", () => {
    // 2026-09-25 is a Friday.
    expect(weekBounds("2026-09-25")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(weekBounds("2026-09-21")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    // A Sunday belongs to the week that just ended, not the one starting.
    expect(weekBounds("2026-09-27")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("covers every day inclusive, across a month boundary", () => {
    expect(dateRange("2026-09-28", "2026-10-02")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02",
    ]);
    expect(dateRange("2026-09-21", "2026-09-27")).toHaveLength(7);
  });
});

describe("hours at work beside hours logged", () => {
  it("lines both halves up day by day", () => {
    const [asha] = buildWorkHours(
      [ASHA],
      [day(101, "2026-09-21", "present", 480), day(101, "2026-09-22", "late", 400)],
      [log(1, "2026-09-21", 300), log(1, "2026-09-22", 360)],
      "2026-09-21",
      "2026-09-22"
    );

    expect(asha.days.map((d) => [d.date, d.presentMinutes, d.loggedMinutes])).toEqual([
      ["2026-09-21", 480, 300],
      ["2026-09-22", 400, 360],
    ]);
    expect(asha.presentMinutes).toBe(880);
    expect(asha.loggedMinutes).toBe(660);
    expect(asha.daysPresent).toBe(2);
    expect(asha.coverage).toBeCloseTo(660 / 880);
    expect(asha.department).toBe("Survey");
  });

  it("ignores minutes on a day nobody was at work", () => {
    // `absent` is this install's catch-all for no clock-in; a stray total on
    // such a row must not inflate the week.
    const [p] = buildWorkHours(
      [ASHA],
      [day(101, "2026-09-21", "absent", 999), day(101, "2026-09-22", "holiday", 0)],
      [],
      "2026-09-21",
      "2026-09-22"
    );
    expect(p.presentMinutes).toBe(0);
    expect(p.daysPresent).toBe(0);
    expect(p.coverage).toBeNull();
  });

  it("still shows time logged on a day with no attendance record", () => {
    // Someone who works without clocking in should be visible, not missing.
    const [p] = buildWorkHours([ASHA], [], [log(1, "2026-09-23", 120)], "2026-09-21", "2026-09-27");
    expect(p.loggedMinutes).toBe(120);
    expect(p.presentMinutes).toBe(0);
    expect(p.coverage).toBeNull();
    expect(p.days).toHaveLength(7);
  });

  it("keeps each person's days to themselves", () => {
    const people = buildWorkHours(
      [ASHA, RAVI],
      [day(101, "2026-09-21", "present", 480), day(102, "2026-09-21", "present", 300)],
      [log(1, "2026-09-21", 60), log(2, "2026-09-21", 240)],
      "2026-09-21",
      "2026-09-21"
    );
    expect(people.map((p) => [p.name, p.presentMinutes, p.loggedMinutes])).toEqual([
      ["Asha", 480, 60],
      ["Ravi", 300, 240],
    ]);
  });

  it("adds up several logs on the same day", () => {
    const [p] = buildWorkHours(
      [ASHA],
      [day(101, "2026-09-21", "present", 480)],
      [log(1, "2026-09-21", 45), log(1, "2026-09-21", 75)],
      "2026-09-21",
      "2026-09-21"
    );
    expect(p.days[0].loggedMinutes).toBe(120);
  });

  it("accepts a datetime where a date is expected", () => {
    // MySQL DATE columns can arrive as "2026-09-21T00:00:00.000Z".
    const [p] = buildWorkHours(
      [ASHA],
      [day(101, "2026-09-21T00:00:00.000Z", "present", 480)],
      [log(1, "2026-09-21T00:00:00.000Z", 60)],
      "2026-09-21",
      "2026-09-21"
    );
    expect(p.presentMinutes).toBe(480);
    expect(p.days[0].loggedMinutes).toBe(60);
  });
});

describe("whose hours you may see", () => {
  const directory = [
    { id: 101, manager_id: null }, // Asha, a manager
    { id: 102, manager_id: 101 }, // reports to Asha
    { id: 103, manager_id: 101 }, // reports to Asha
    { id: 104, manager_id: 999 }, // reports to someone else
  ];

  it("an admin sees everyone", () => {
    expect(visibleEmployeeIds({ employeeId: 104, isAdmin: true }, directory)).toEqual([
      101, 102, 103, 104,
    ]);
  });

  it("a manager sees themselves and their own reports", () => {
    expect(visibleEmployeeIds({ employeeId: 101, isAdmin: false }, directory).sort()).toEqual([
      101, 102, 103,
    ]);
  });

  it("everyone else sees only themselves", () => {
    expect(visibleEmployeeIds({ employeeId: 102, isAdmin: false }, directory)).toEqual([102]);
    // Not their manager's other reports, and not their manager.
    expect(visibleEmployeeIds({ employeeId: 104, isAdmin: false }, directory)).toEqual([104]);
  });
});

describe("minutes, written for people", () => {
  it("reads as hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(485)).toBe("8h 5m");
    expect(formatMinutes(-5)).toBe("0m");
  });
});
