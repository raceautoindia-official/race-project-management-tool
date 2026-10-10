import { beforeAll, describe, expect, it } from "vitest";
import { query, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

import * as planner from "@/app/api/planner/route";
import * as plannerExport from "@/app/api/planner/export/route";

type Json = Record<string, unknown> & { error?: string };
interface Entry {
  entry_date: string;
  plan: string | null;
  progress: string | null;
  user_id?: number;
  user_name?: string;
}

let admin: User, lead: User, sam: User, outsider: User;

const THU = "2026-10-08"; // a Thursday
const MON = "2026-10-05"; // that week's Monday

beforeAll(async () => {
  admin = await createUser("Planadmin", "admin");
  lead = await createUser("Planlead");
  sam = await createUser("Plansam");
  outsider = await createUser("Planout");
  const pid = await createLedProject(lead, "Planner project");
  await query(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?)`, [pid, sam.id]);
});

describe("the planner is written by the person it is about", () => {
  it("saves a day and reads it back", async () => {
    actAs(sam);
    const saved = await call<{ entry: Entry }>(planner.PUT, {
      method: "PUT",
      body: { period: "day", date: THU, plan: "Finish the CSV export", progress: "" },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.entry.plan).toBe("Finish the CSV export");
    expect(saved.body.entry.progress).toBeNull();

    const read = await call<{ entry: Entry }>(planner.GET, { path: `/?period=day&date=${THU}` });
    expect(read.body.entry.plan).toBe("Finish the CSV export");
  });

  it("replaces the same day rather than stacking entries up", async () => {
    actAs(sam);
    await call(planner.PUT, {
      method: "PUT",
      body: { period: "day", date: THU, plan: "Finish the CSV export", progress: "Done by 4" },
    });
    const rows = await query<DbRow[]>(
      `SELECT id FROM planner_entries WHERE user_id = ? AND period = 'day'`,
      [sam.id]
    );
    expect(rows).toHaveLength(1);
  });

  it("files any day of a week under that week's Monday", async () => {
    actAs(sam);
    // Written on the Thursday, and again on the Saturday of the same week.
    await call(planner.PUT, {
      method: "PUT",
      body: { period: "week", date: THU, plan: "Ship the export" },
    });
    await call(planner.PUT, {
      method: "PUT",
      body: { period: "week", date: "2026-10-10", progress: "Shipped", plan: "Ship the export" },
    });

    const rows = await query<DbRow[]>(
      `SELECT DATE_FORMAT(entry_date, '%Y-%m-%d') AS d FROM planner_entries
        WHERE user_id = ? AND period = 'week'`,
      [sam.id]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].d).toBe(MON);
  });

  it("takes an entry back when both boxes are emptied", async () => {
    actAs(sam);
    await call(planner.PUT, {
      method: "PUT",
      body: { period: "day", date: "2026-10-09", plan: "Something" },
    });
    const gone = await call<{ entry: Entry | null }>(planner.PUT, {
      method: "PUT",
      body: { period: "day", date: "2026-10-09", plan: "", progress: "   " },
    });
    expect(gone.body.entry).toBeNull();
    const rows = await query<DbRow[]>(
      `SELECT id FROM planner_entries WHERE user_id = ? AND entry_date = '2026-10-09'`,
      [sam.id]
    );
    expect(rows).toHaveLength(0);
  });

  it("refuses a date that is not one", async () => {
    actAs(sam);
    const res = await call<Json>(planner.PUT, {
      method: "PUT",
      body: { period: "day", date: "2026-02-30", plan: "Never" },
    });
    expect(res.status).toBe(400);
  });
});

describe("who may read whose planner", () => {
  it("shows a lead the people on the project they lead", async () => {
    actAs(lead);
    const res = await call<{ entries: Entry[] }>(planner.GET, {
      path: `/?scope=team&period=day&date=${THU}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e) => e.user_id)).toContain(sam.id);
  });

  it("shows an admin everyone", async () => {
    actAs(admin);
    const res = await call<{ entries: Entry[] }>(planner.GET, {
      path: `/?scope=team&period=day&date=${THU}`,
    });
    expect(res.body.entries.map((e) => e.user_id)).toContain(sam.id);
  });

  it("shows a member nobody but themselves", async () => {
    actAs(outsider);
    const team = await call<{ entries: Entry[] }>(planner.GET, {
      path: `/?scope=team&period=day&date=${THU}`,
    });
    expect(team.body.entries).toHaveLength(0);

    const theirs = await call<Json>(planner.GET, {
      path: `/?period=day&date=${THU}&userId=${sam.id}`,
    });
    expect(theirs.status).toBe(403);
  });

  it("is nobody else's to write, whatever their role", async () => {
    actAs(admin);
    await call(planner.PUT, {
      method: "PUT",
      body: { period: "day", date: THU, plan: "The admin's own" },
    });
    // The admin's own entry, not an edit of Sam's: there is no way to write
    // into somebody else's planner at all.
    const sams = await query<DbRow[]>(
      `SELECT plan FROM planner_entries WHERE user_id = ? AND period = 'day' AND entry_date = ?`,
      [sam.id, THU]
    );
    expect(sams[0].plan).toBe("Finish the CSV export");
  });
});

describe("downloading it", () => {
  it("gives a spreadsheet of your own range", async () => {
    actAs(sam);
    const res = await call(plannerExport.GET, {
      path: `/?period=day&from=2026-10-01&to=2026-10-31`,
    });
    expect(res.status).toBe(200);
    expect(res.res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.res.headers.get("content-disposition")).toContain("planner-day-2026-10-01");
    const body = await res.res.arrayBuffer();
    // A real xlsx is a zip, which starts "PK".
    expect(Buffer.from(body.slice(0, 2)).toString()).toBe("PK");
  });

  it("gives a lead the team's, and refuses a planner they cannot read", async () => {
    actAs(lead);
    const team = await call(plannerExport.GET, {
      path: `/?scope=team&period=day&date=${THU}`,
    });
    expect(team.status).toBe(200);

    actAs(outsider);
    const theirs = await call(plannerExport.GET, {
      path: `/?period=day&from=${THU}&to=${THU}&userId=${sam.id}`,
    });
    // What you can download is what you can see.
    expect(theirs.status).toBe(403);
  });
});
