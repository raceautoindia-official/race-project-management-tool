import { describe, expect, it } from "vitest";
import {
  describePeriod,
  entryDateFor,
  isDateKey,
  rangeBack,
  shiftPeriod,
  todayIst,
  weekDays,
  weekStart,
} from "@/lib/planner";

describe("which day a planner entry belongs to", () => {
  it("takes a week back to its Monday", () => {
    // Thu 8 Oct 2026 → Mon 5 Oct 2026.
    expect(weekStart("2026-10-08")).toBe("2026-10-05");
    expect(weekStart("2026-10-05")).toBe("2026-10-05");
    // Sunday belongs to the week that has just ended, not the one starting.
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
  });

  it("files every day of a week under the same entry", () => {
    const days = weekDays("2026-10-08");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-10-05");
    expect(days[6]).toBe("2026-10-11");
    // This is what stops one week being written twice.
    const filed = new Set(days.map((d) => entryDateFor("week", d)));
    expect([...filed]).toEqual(["2026-10-05"]);
  });

  it("leaves a daily entry on its own day", () => {
    expect(entryDateFor("day", "2026-10-08")).toBe("2026-10-08");
  });

  it("steps a day or a week at a time, across month and year ends", () => {
    expect(shiftPeriod("day", "2026-10-08", 1)).toBe("2026-10-09");
    expect(shiftPeriod("day", "2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftPeriod("day", "2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftPeriod("week", "2026-10-08", -1)).toBe("2026-09-28");
    expect(shiftPeriod("week", "2026-12-31", 1)).toBe("2027-01-04");
  });

  it("handles a leap day without losing it", () => {
    expect(shiftPeriod("day", "2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftPeriod("day", "2028-02-29", 1)).toBe("2028-03-01");
    expect(weekStart("2028-02-29")).toBe("2028-02-28");
  });

  it("reaches back a month of days or a quarter of weeks", () => {
    expect(rangeBack("day", "2026-10-08", 29)).toBe("2026-09-09");
    expect(rangeBack("week", "2026-10-08", 11)).toBe("2026-07-20");
  });

  it("names a period the way someone would say it", () => {
    expect(describePeriod("day", "2026-10-08")).toBe("8 Oct 2026");
    expect(describePeriod("week", "2026-10-08")).toBe("5–11 Oct 2026");
    // A week that straddles two months says both.
    // "Sept", not "Sep": en-GB spells it that way, and so does the rest
    // of the app.
    expect(describePeriod("week", "2026-09-30")).toBe("28 Sept–4 Oct 2026");
  });

  it("refuses a date that is not one", () => {
    expect(isDateKey("2026-10-08")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("08-10-2026")).toBe(false);
    expect(isDateKey("")).toBe(false);
  });

  it("reads the Indian calendar day, not the server's", () => {
    // 22:00 UTC is already tomorrow in India.
    expect(todayIst(new Date("2026-10-08T22:00:00Z"))).toBe("2026-10-09");
    expect(todayIst(new Date("2026-10-08T18:29:00Z"))).toBe("2026-10-08");
    expect(todayIst(new Date("2026-10-08T18:31:00Z"))).toBe("2026-10-09");
  });
});
