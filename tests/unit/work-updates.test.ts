import { describe, expect, it } from "vitest";
import { editableUntil, isLocked, isWorkDay, updateStatus, type UpdateStatus } from "@/lib/planner";
import { DEFAULT_SETTINGS, istClock, mergeSettings, submissionRate } from "@/lib/work-updates";

// 2026-10-26 is a Monday; 2026-11-01 the Sunday after.
describe("which days owe an update", () => {
  it("is Monday to Saturday", () => {
    expect(["2026-10-26", "2026-10-27", "2026-10-31"].every(isWorkDay)).toBe(true);
    expect(isWorkDay("2026-11-01")).toBe(false);
  });
});

describe("the midnight lock", () => {
  it("closes a day at the end of that day", () => {
    expect(editableUntil("day", "2026-10-28")).toBe("2026-10-28");
    expect(isLocked("day", "2026-10-28", "2026-10-28")).toBe(false);
    expect(isLocked("day", "2026-10-28", "2026-10-29")).toBe(true);
    // Ahead is open: you can plan tomorrow today.
    expect(isLocked("day", "2026-10-30", "2026-10-28")).toBe(false);
  });

  it("closes a week at the end of its Saturday", () => {
    expect(editableUntil("week", "2026-10-28")).toBe("2026-10-31");
    expect(isLocked("week", "2026-10-26", "2026-10-31")).toBe(false);
    expect(isLocked("week", "2026-10-26", "2026-11-01")).toBe(true);
  });
});

describe("where an update stands", () => {
  const today = "2026-10-28";
  it("tells handed-in from auto-submitted from still open", () => {
    expect(updateStatus("day", today, today, { submission: "manual", plan: "x" })).toBe("submitted");
    expect(updateStatus("day", "2026-10-27", today, { submission: "auto", plan: null })).toBe("auto");
    expect(updateStatus("day", today, today, { plan: "x" })).toBe("draft");
    expect(updateStatus("day", today, today, null)).toBe("due");
  });

  it("calls a past day with nothing handed in missing, and leaves Sunday and the future alone", () => {
    expect(updateStatus("day", "2026-10-27", today, null)).toBe("missing");
    expect(updateStatus("day", "2026-10-25", today, null)).toBe("off");
    expect(updateStatus("day", "2026-10-29", today, null)).toBe("upcoming");
  });
});

describe("before submitting began", () => {
  it("counts nothing as missing, and what was written as handed in", () => {
    const since = "2026-10-29";
    expect(updateStatus("day", "2026-10-27", "2026-10-30", null, since)).toBe("untracked");
    expect(updateStatus("day", "2026-10-27", "2026-10-30", { plan: "x" }, since)).toBe("submitted");
    expect(updateStatus("day", "2026-10-29", "2026-10-30", null, since)).toBe("missing");
    // The week it began in is tracked.
    expect(updateStatus("week", "2026-10-26", "2026-10-30", null, since)).toBe("due");
  });
});

describe("the submission rate", () => {
  it("counts only days that are over or handed in, and only the person's own", () => {
    const cell = (status: UpdateStatus) => ({
      date: "x",
      status,
      submitted_at: null,
      reminded: 0,
    });
    expect(submissionRate([cell("submitted"), cell("auto"), cell("missing"), cell("off"), cell("due")])).toBe(33);
    expect(submissionRate([cell("off"), cell("upcoming")])).toBeNull();
  });
});

describe("reminder settings", () => {
  it("fills in what is missing and refuses nonsense", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = mergeSettings({ dailyReminder: { on: false, time: "25:00" }, autoSubmitTime: "08:00", email: false });
    expect(s.dailyReminder).toEqual({ on: false, time: DEFAULT_SETTINGS.dailyReminder.time });
    // A morning auto-submit would hand in the day before it is lived.
    expect(s.autoSubmitTime).toBe(DEFAULT_SETTINGS.autoSubmitTime);
    expect(s.email).toBe(false);
  });

  it("reads the clock in India", () => {
    expect(istClock(new Date("2026-10-28T12:35:00Z"))).toBe("18:05");
  });
});
