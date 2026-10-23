import { beforeAll, describe, expect, it } from "vitest";
import { query, DbResult } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";
import { dailySummary, dailySummaryLines, summaryLine } from "@/lib/daily-summary";

import * as summaryRoute from "@/app/api/planner/summary/route";

type Json = Record<string, unknown> & { error?: string };

let lead: User, sam: User, outsider: User;
let projectId: number;

const DAY = "2026-10-08";
// 18:30 UTC is midnight in India, so these two sit either side of the line.
const LATE_ON_THE_DAY = "2026-10-08 18:00:00"; // 11:30pm IST on the 8th
const JUST_AFTER = "2026-10-08 19:00:00"; // 12:30am IST on the 9th

async function makeTask(
  title: string,
  extra = { additional: false, completedAt: null as string | null }
): Promise<number> {
  const res = (await query<DbResult>(
    `INSERT INTO tasks (project_id, title, assignee_id, created_by, requested_by,
                        request_approved_by, is_additional, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      title,
      sam.id,
      lead.id,
      lead.id,
      lead.id,
      extra.additional ? 1 : 0,
      extra.completedAt,
      extra.additional ? LATE_ON_THE_DAY : "2026-10-01 06:00:00",
    ]
  )) as unknown as DbResult;
  return res.insertId;
}

beforeAll(async () => {
  lead = await createUser("Sumlead");
  sam = await createUser("Sumsam");
  outsider = await createUser("Sumout");
  projectId = await createLedProject(lead, "Summary project");
  await query(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?)`, [
    projectId,
    sam.id,
  ]);
});

describe("the day fills itself in", () => {
  let worked: number;

  it("counts the time logged that day, and leaves the next day alone", async () => {
    worked = await makeTask("Dealer CSV export");
    await query(
      `INSERT INTO task_time_logs (task_id, user_id, minutes, logged_at)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)`,
      [
        worked, sam.id, 90, "2026-10-08 05:00:00",
        worked, sam.id, 30, LATE_ON_THE_DAY,
        // Half an hour past midnight in India: a different day's work.
        worked, sam.id, 45, JUST_AFTER,
      ]
    );

    const s = await dailySummary(sam.id, DAY);
    expect(s.worked).toHaveLength(1);
    expect(s.worked[0].title).toBe("Dealer CSV export");
    // 90 + 30, not 165: the Indian calendar day, like everywhere else.
    expect(s.totalMinutes).toBe(120);

    const next = await dailySummary(sam.id, "2026-10-09");
    expect(next.totalMinutes).toBe(45);
  });

  it("lists what was finished and what came in extra", async () => {
    await makeTask("Fix the contact form", {
      additional: false,
      completedAt: "2026-10-08 09:00:00",
    });
    await makeTask("Also fix the footer", { additional: true, completedAt: null });

    const s = await dailySummary(sam.id, DAY);
    expect(s.completed.map((t) => t.title)).toEqual(["Fix the contact form"]);
    // Follow-up work nobody planned at the start of the day.
    expect(s.extra.map((t) => t.title)).toEqual(["Also fix the footer"]);
  });

  it("says plainly when a day is empty rather than inventing a figure", async () => {
    const s = await dailySummary(outsider.id, DAY);
    expect(s.empty).toBe(true);
    expect(summaryLine(s)).toBe("");
  });

  it("sums it up in one line", async () => {
    const line = summaryLine(await dailySummary(sam.id, DAY));
    expect(line).toContain("1 task (2h)");
    expect(line).toContain("1 finished");
    expect(line).toContain("1 extra");
  });

  it("does the same for a group in one go", async () => {
    const lines = await dailySummaryLines([sam.id, outsider.id], DAY);
    expect(lines.get(sam.id)).toContain("2h");
    // Nothing recorded means no line at all, not an empty one.
    expect(lines.has(outsider.id)).toBe(false);
  });
});

describe("reading someone else's day", () => {
  it("gives it to a lead of their project", async () => {
    actAs(lead);
    const res = await call<{ summary: { totalMinutes: number } }>(summaryRoute.GET, {
      path: `/?date=${DAY}&userId=${sam.id}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.summary.totalMinutes).toBe(120);
  });

  it("refuses someone with no business reading it", async () => {
    actAs(outsider);
    const res = await call<Json>(summaryRoute.GET, {
      path: `/?date=${DAY}&userId=${sam.id}`,
    });
    expect(res.status).toBe(403);
  });

  it("defaults to your own day", async () => {
    actAs(sam);
    const res = await call<{ summary: { totalMinutes: number } }>(summaryRoute.GET, {
      path: `/?date=${DAY}`,
    });
    expect(res.body.summary.totalMinutes).toBe(120);
  });
});
