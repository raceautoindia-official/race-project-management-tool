import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/attendance", () => ({ attendancePool: {} }));

import { describeSchedule, fallsOn, place, scheduledDates, upcoming, weekdayOf, type Schedule } from "@/lib/recurrence";
import { calendarFrom } from "@/lib/workdays";

/** 2026-11-02 is a Monday. */
const weekly = (over: Partial<Schedule> = {}): Schedule => ({
  frequency: "weekly",
  interval: 1,
  weekdays: ["Mon", "Thu"],
  monthDay: null,
  startDate: "2026-11-02",
  endDate: null,
  ...over,
});
const monthly = (monthDay: number, over: Partial<Schedule> = {}): Schedule => ({ ...weekly(), frequency: "monthly", weekdays: [], monthDay, ...over });
const allWorking = () => true;

describe("when a rule falls due", () => {
  it("weekly on chosen days", () => {
    expect(scheduledDates(weekly(), "2026-11-02", "2026-11-15")).toEqual(["2026-11-02", "2026-11-05", "2026-11-09", "2026-11-12"]);
  });

  it("every other week, counted from the week it starts", () => {
    expect(scheduledDates(weekly({ interval: 2, weekdays: ["Fri"] }), "2026-11-01", "2026-11-30")).toEqual([
      "2026-11-06",
      "2026-11-20",
    ]);
  });

  it("monthly on a day, using the last day when a month is short", () => {
    expect(scheduledDates(monthly(31, { startDate: "2027-01-01" }), "2027-01-01", "2027-04-30")).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("monthly on the last day, every quarter", () => {
    expect(scheduledDates(monthly(0, { interval: 3, startDate: "2026-11-01" }), "2026-11-01", "2027-06-30")).toEqual([
      "2026-11-30",
      "2027-02-28",
      "2027-05-31",
    ]);
  });

  it("never before it starts or after it ends", () => {
    const s = weekly({ startDate: "2026-11-04", endDate: "2026-11-10" });
    expect(fallsOn(s, "2026-11-02")).toBe(false);
    expect(scheduledDates(s, "2026-11-01", "2026-11-30")).toEqual(["2026-11-05", "2026-11-09"]);
  });
});

describe("holidays and days off", () => {
  it("move a weekly date to the next working day", () => {
    const closedMonday = (d: string) => d !== "2026-11-09";
    expect(place(weekly(), "2026-11-09", closedMonday)).toEqual({ date: "2026-11-09", on: "2026-11-10", reason: "holiday_or_day_off" });
  });

  it("never move it past the next scheduled date", () => {
    const closed = (d: string) => !["2026-11-02", "2026-11-03", "2026-11-04"].includes(d);
    // Mon, Tue, Wed off: the move would reach Thursday, which has its own copy.
    expect(place(weekly(), "2026-11-02", closed).on).toBeNull();
  });

  it("skip a daily date", () => {
    const daily: Schedule = { ...weekly(), frequency: "daily" };
    expect(place(daily, "2026-11-08", (d) => weekdayOf(d) !== "Sun").on).toBeNull();
    expect(upcoming(daily, "2026-11-06", 3, (d) => weekdayOf(d) !== "Sun")).toEqual(["2026-11-06", "2026-11-07", "2026-11-09"]);
  });

  it("follow the person's shift and the holidays observed where they work", () => {
    const cal = calendarFrom(
      [{ employee_id: 7, location_id: 2, effective_from: "2026-01-01", effective_to: null, working_days: ["Mon", "Tue", "Wed", "Thu", "Fri"] }],
      [
        { date: "2026-11-10", name: "Local festival", location_id: 2 },
        { date: "2026-11-11", name: "Elsewhere", location_id: 9 },
        { date: "2026-11-12", name: "National day", location_id: null },
      ]
    );
    expect(cal.isWorkingDay(7, "2026-11-07")).toBe(false); // Saturday: not on their shift
    expect(cal.isWorkingDay(7, "2026-11-10")).toBe(false);
    expect(cal.holidayName(7, "2026-11-10")).toBe("Local festival");
    expect(cal.isWorkingDay(7, "2026-11-11")).toBe(true); // another location's holiday
    expect(cal.isWorkingDay(7, "2026-11-12")).toBe(false);
    // No schedule: Monday to Saturday.
    expect(cal.isWorkingDay(8, "2026-11-07")).toBe(true);
    expect(cal.isWorkingDay(8, "2026-11-08")).toBe(false);
  });

  it("skips nothing when WorkLens can't be read", () => {
    const cal = calendarFrom([], [], true);
    expect(cal.isWorkingDay(7, "2026-11-08")).toBe(true);
    expect(cal.unavailable).toBe(true);
  });
});

describe("how a schedule reads", () => {
  it("in words", () => {
    expect(describeSchedule({ frequency: "daily", interval: 1, weekdays: [], monthDay: null })).toBe("Every working day");
    expect(describeSchedule(weekly())).toBe("Every Mon & Thu");
    expect(describeSchedule(weekly({ weekdays: ["Fri"], interval: 2 }))).toBe("Every 2 weeks on Friday");
    expect(describeSchedule(weekly({ weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"] }))).toBe("Every weekday (Mon–Fri)");
    expect(describeSchedule(monthly(0))).toBe("Monthly on the last day");
    expect(describeSchedule(monthly(1, { interval: 3 }))).toBe("Every 3 months on the 1st");
  });
});

it("all-working calendars place a date on itself", () => {
  expect(place(weekly(), "2026-11-05", allWorking).on).toBe("2026-11-05");
});
