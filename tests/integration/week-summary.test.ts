import { beforeAll, describe, expect, it } from "vitest";
import { query, DbResult } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";
import { upcomingLine, weekLine, weekSummary } from "@/lib/week-summary";

import * as summaryRoute from "@/app/api/planner/summary/route";

let lead: User, sam: User;
let projectId: number;

// Mon 5 Oct 2026 to Sun 11 Oct 2026.
const MON = "2026-10-05";
const WED = "2026-10-07";
const NEXT_MON = "2026-10-12";

async function makeTask(
  title: string,
  over: Partial<{
    due: string | null;
    status: string;
    priority: string;
    hours: number | null;
    additional: boolean;
    completedAt: string | null;
    createdAt: string;
  }> = {}
): Promise<number> {
  const res = (await query<DbResult>(
    `INSERT INTO tasks (project_id, title, assignee_id, created_by, requested_by,
                        request_approved_by, due_date, status, priority,
                        estimated_hours, is_additional, completed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      title,
      sam.id,
      lead.id,
      lead.id,
      lead.id,
      over.due ?? null,
      over.status ?? "todo",
      over.priority ?? "medium",
      over.hours ?? null,
      over.additional ? 1 : 0,
      over.completedAt ?? null,
      over.createdAt ?? "2026-09-01 06:00:00",
    ]
  )) as unknown as DbResult;
  return res.insertId;
}

beforeAll(async () => {
  lead = await createUser("Weeklead");
  sam = await createUser("Weeksam");
  projectId = await createLedProject(lead, "Week project");
  await query(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?)`, [
    projectId,
    sam.id,
  ]);
});

describe("the week proposes itself from what is due", () => {
  it("takes the tasks due that week, soonest and most urgent first", async () => {
    await makeTask("Ship the export", { due: WED, priority: "high", hours: 6 });
    await makeTask("Write the handover", { due: "2026-10-09", priority: "low" });
    // Next week is not this week's problem.
    await makeTask("Later thing", { due: NEXT_MON });

    const w = await weekSummary(sam.id, MON);
    expect(w.upcoming.map((t) => t.title)).toEqual([
      "Ship the export",
      "Write the handover",
    ]);
    expect(w.upcoming[0].estimated_hours).toBe(6);
  });

  it("carries over what was already overdue and still open", async () => {
    await makeTask("Should have been done in September", { due: "2026-09-28" });
    const w = await weekSummary(sam.id, MON);
    const carried = w.upcoming.find((t) => t.title.startsWith("Should have been"));
    // Still this week's problem, and said to be.
    expect(carried?.overdue).toBe(true);
    expect(upcomingLine(w.upcoming)).toContain("1 carried over");
  });

  it("leaves out what is already finished or signed off", async () => {
    await makeTask("Already done", { due: WED, status: "done" });
    const w = await weekSummary(sam.id, MON);
    expect(w.upcoming.map((t) => t.title)).not.toContain("Already done");
  });

  it("counts what the week came to, as it goes", async () => {
    const done = await makeTask("Finished mid-week", {
      due: WED,
      completedAt: "2026-10-07 09:00:00",
    });
    await makeTask("Extra that came in", {
      additional: true,
      createdAt: "2026-10-08 05:00:00",
    });
    await query(
      `INSERT INTO task_time_logs (task_id, user_id, minutes, logged_at)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
      [done, sam.id, 120, "2026-10-06 05:00:00", done, sam.id, 60, "2026-10-07 05:00:00"]
    );

    const w = await weekSummary(sam.id, MON);
    expect(w.totalMinutes).toBe(180);
    expect(w.daysWorked).toBe(2);
    expect(w.completed.map((t) => t.title)).toContain("Finished mid-week");
    expect(w.extra.map((t) => t.title)).toContain("Extra that came in");
    expect(weekLine(w)).toContain("3h");
    expect(weekLine(w)).toContain("over 2 days");
  });

  it("says nothing rather than something empty for a quiet week", async () => {
    const quiet = await createUser("Weekquiet");
    const w = await weekSummary(quiet.id, MON);
    expect(w.empty).toBe(true);
    expect(weekLine(w)).toBe("");
    expect(upcomingLine(w.upcoming)).toBe("");
  });
});

describe("asking for a week over the wire", () => {
  it("files any day of the week under its Monday", async () => {
    actAs(sam);
    // Asked for the Thursday; answered for the week it belongs to.
    const res = await call<{ date: string; week: { upcoming: { title: string }[] } }>(
      summaryRoute.GET,
      { path: `/?period=week&date=2026-10-08` }
    );
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(MON);
    expect(res.body.week.upcoming.length).toBeGreaterThan(0);
  });

  it("gives a lead their team member's week", async () => {
    actAs(lead);
    const res = await call<{ week: { totalMinutes: number } }>(summaryRoute.GET, {
      path: `/?period=week&date=${MON}&userId=${sam.id}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.week.totalMinutes).toBe(180);
  });
});
