import { describe, expect, it } from "vitest";
import { parseISO } from "date-fns";
import { scaleFor, ticksFor } from "@/components/project/TimelineView";

// The timeline has to stay readable whether a project runs for a fortnight or
// (because of one stray date) for years.
describe("timeline scale", () => {
  it("coarsens as the range grows", () => {
    expect(scaleFor(14).unit).toBe("day");
    expect(scaleFor(31).unit).toBe("day");
    expect(scaleFor(32).unit).toBe("week");
    expect(scaleFor(120).unit).toBe("week");
    expect(scaleFor(121).unit).toBe("month");
    expect(scaleFor(730).unit).toBe("month");
    expect(scaleFor(2400).unit).toBe("quarter"); // the 2020 → 2026 case
  });

  it("gives every scale enough room per label to be readable", () => {
    for (const days of [7, 30, 90, 365, 1200, 2400, 9000]) {
      const { unit, pxPerDay } = scaleFor(days);
      const width = Math.min(6000, Math.max(680, Math.round(days * pxPerDay)));
      // Labels are ~70px wide; the stride the view applies must keep them apart.
      const all = ticksFor(
        unit,
        parseISO("2020-01-01"),
        new Date(parseISO("2020-01-01").getTime() + days * 86_400_000)
      );
      const stride = Math.max(1, Math.ceil((all.length * 76) / width));
      const shown = all.filter((_, i) => i % stride === 0).length;
      expect(shown * 76).toBeLessThanOrEqual(width + 76);
      expect(shown).toBeGreaterThan(0);
    }
  });

  it("puts ticks on sensible boundaries", () => {
    const weekly = ticksFor("week", parseISO("2026-09-03"), parseISO("2026-10-01"));
    // Mondays only.
    expect(weekly.every((t) => t.getDay() === 1)).toBe(true);

    const monthly = ticksFor("month", parseISO("2026-01-15"), parseISO("2026-06-01"));
    expect(monthly.every((t) => t.getDate() === 1)).toBe(true);
    expect(monthly).toHaveLength(5); // Feb–Jun (Jan 1 is before the start)

    const quarters = ticksFor("quarter", parseISO("2020-01-01"), parseISO("2021-01-01"));
    expect(quarters.map((q) => q.getMonth())).toEqual([0, 3, 6, 9, 0]);
  });
});
