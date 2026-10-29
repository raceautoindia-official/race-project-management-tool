import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { query, DbRow } from "@/lib/db";
import type { User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";

import * as planner from "@/app/api/planner/route";
import * as submit from "@/app/api/planner/submit/route";
import * as remind from "@/app/api/work-updates/remind/route";
import * as settingsRoute from "@/app/api/admin/update-settings/route";
import {
  autoSubmitDay,
  autoSubmitWeek,
  dailyStatusGrid,
  runWorkUpdateJobs,
} from "@/lib/work-updates";
import { getPersonProfile } from "@/lib/person-profile";

type Json = Record<string, unknown> & { error?: string };

/**
 * Work updates are submitted, locked at midnight, submitted by the app when
 * people don't, and nudged by reminders. "Today" in these tests is
 * Wednesday 2026-06-10 (India), set on the clock.
 */
const TODAY = "2026-06-10"; // Wednesday
const YESTERDAY = "2026-06-09";
const MONDAY = "2026-06-08";

let admin: User, lead: User, ana: User, ben: User, outsider: User;

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${TODAY}T06:00:00Z`) }); // 11:30 in India
  admin = await createUser("WuAdmin", "admin");
  lead = await createUser("WuLead");
  ana = await createUser("WuAna");
  ben = await createUser("WuBen");
  outsider = await createUser("WuOut");
  const pid = await createLedProject(lead, "Work updates project");
  await query(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?), (?, ?)`, [pid, ana.id, pid, ben.id]);
});
afterAll(() => {
  vi.useRealTimers();
});

const entry = async (userId: number, period: "day" | "week", date: string) =>
  (
    await query<DbRow[]>(
      `SELECT plan, progress, submission, submitted_at FROM planner_entries WHERE user_id = ? AND period = ? AND entry_date = ?`,
      [userId, period, date]
    )
  )[0];

describe("submitting your own update", () => {
  it("needs something written, then marks it submitted and keeps it editable until midnight", async () => {
    actAs(ana);
    const empty = await call<Json>(submit.POST, { method: "POST", body: { period: "day", date: TODAY } });
    expect(empty.status).toBe(400);

    await call(planner.PUT, { method: "PUT", body: { period: "day", date: TODAY, plan: "Fit the panel", progress: "" } });
    const done = await call<{ entry: { submission: string } }>(submit.POST, {
      method: "POST",
      body: { period: "day", date: TODAY },
    });
    expect(done.status).toBe(200);
    expect(done.body.entry.submission).toBe("manual");

    // Still today: it can be changed, and stays submitted.
    const edited = await call(planner.PUT, {
      method: "PUT",
      body: { period: "day", date: TODAY, plan: "Fit the panel", progress: "Fitted" },
    });
    expect(edited.status).toBe(200);
    expect((await entry(ana.id, "day", TODAY)).submission).toBe("manual");
  });

  it("locks a day at midnight, and a week at midnight on Saturday", async () => {
    actAs(ana);
    const past = await call<Json>(planner.PUT, {
      method: "PUT",
      body: { period: "day", date: YESTERDAY, plan: "Too late", progress: "" },
    });
    expect(past.status).toBe(409);
    expect((await call(submit.POST, { method: "POST", body: { period: "day", date: YESTERDAY } })).status).toBe(409);

    // This week is still open on a Wednesday; last week is not.
    expect(
      (await call(planner.PUT, { method: "PUT", body: { period: "week", date: TODAY, plan: "Ship it", progress: "" } })).status
    ).toBe(200);
    expect(
      (await call(planner.PUT, { method: "PUT", body: { period: "week", date: "2026-06-03", plan: "Late", progress: "" } })).status
    ).toBe(409);

    const read = await call<{ locked: boolean }>(planner.GET, { path: `/?period=day&date=${YESTERDAY}` });
    expect(read.body.locked).toBe(true);
  });
});

describe("what the app submits by itself", () => {
  it("submits a day nobody handed in, keeps what was written, and leaves admins and submitted days alone", async () => {
    // Ben wrote a plan yesterday but never submitted; Ana submitted hers.
    await query(
      `INSERT INTO planner_entries (user_id, period, entry_date, plan) VALUES (?, 'day', ?, 'Order parts')
       ON DUPLICATE KEY UPDATE plan = VALUES(plan), submission = NULL, submitted_at = NULL`,
      [ben.id, YESTERDAY]
    );
    await query(
      `INSERT INTO planner_entries (user_id, period, entry_date, plan, submitted_at, submission)
       VALUES (?, 'day', ?, 'Mine', UTC_TIMESTAMP(), 'manual')
       ON DUPLICATE KEY UPDATE submission = 'manual'`,
      [ana.id, YESTERDAY]
    );

    await autoSubmitDay(YESTERDAY);
    expect(await entry(ben.id, "day", YESTERDAY)).toMatchObject({ plan: "Order parts", submission: "auto" });
    expect((await entry(ana.id, "day", YESTERDAY)).submission).toBe("manual");
    // Someone who wrote nothing still gets a record: submitted by the app.
    expect((await entry(lead.id, "day", YESTERDAY)).submission).toBe("auto");
    expect(await entry(admin.id, "day", YESTERDAY)).toBeUndefined();
  });

  it("doesn't submit Sundays, and submits the week too", async () => {
    expect(await autoSubmitDay("2026-06-07")).toBe(0); // a Sunday
    await autoSubmitWeek("2026-06-01");
    expect((await entry(ben.id, "week", "2026-06-01")).submission).toBe("auto");
  });
});

describe("the schedule", () => {
  it("sends the daily reminder once, only to people who haven't submitted, and only after its time", async () => {
    const reminders = () =>
      query<DbRow[]>(`SELECT user_id FROM update_reminders WHERE kind = 'day' AND ref_date = ? AND sent_by IS NULL`, [TODAY]);
    await runWorkUpdateJobs(new Date(`${TODAY}T06:00:00Z`)); // 11:30, before 18:00
    expect(await reminders()).toHaveLength(0);

    await runWorkUpdateJobs(new Date(`${TODAY}T12:35:00Z`)); // 18:05
    const sent = (await reminders()).map((r) => Number(r.user_id));
    expect(sent).toContain(ben.id);
    expect(sent).not.toContain(ana.id); // she submitted
    expect(sent).not.toContain(admin.id);
    const notes = await query<DbRow[]>(`SELECT type FROM notifications WHERE user_id = ? AND type = 'update_reminder'`, [ben.id]);
    expect(notes.length).toBeGreaterThanOrEqual(1);

    // Fired again a quarter of an hour later: nothing new.
    await runWorkUpdateJobs(new Date(`${TODAY}T12:50:00Z`));
    expect((await reminders()).length).toBe(sent.length);
  });

  it("submits the day at the auto-submit time", async () => {
    await runWorkUpdateJobs(new Date(`${TODAY}T18:05:00Z`)); // 23:35 India
    expect((await entry(ben.id, "day", TODAY)).submission).toBe("auto");
    expect((await entry(ana.id, "day", TODAY)).submission).toBe("manual");
  });
});

describe("reminding by hand", () => {
  it("lets an admin remind anyone, and skips whoever already did it", async () => {
    actAs(admin);
    const res = await call<{ sent: number; skipped: number }>(remind.POST, {
      method: "POST",
      body: { kind: "week_plan", date: TODAY, userIds: [ana.id, ben.id] },
    });
    expect(res.status).toBe(200);
    // Ana wrote this week's plan above; Ben did not.
    expect(res.body).toEqual({ sent: 1, skipped: 1 });
    const [r] = await query<DbRow[]>(
      `SELECT sent_by, DATE_FORMAT(ref_date, '%Y-%m-%d') AS ref FROM update_reminders WHERE user_id = ? AND kind = 'week_plan' ORDER BY id DESC LIMIT 1`,
      [ben.id]
    );
    expect({ ...r }).toEqual({ sent_by: admin.id, ref: MONDAY });
  });

  it("lets a lead remind only the people on their projects, and a member nobody", async () => {
    actAs(lead);
    expect(
      (await call(remind.POST, { method: "POST", body: { kind: "day", date: TODAY, userIds: [ben.id] } })).status
    ).toBe(200);
    expect(
      (await call(remind.POST, { method: "POST", body: { kind: "day", date: TODAY, userIds: [outsider.id] } })).status
    ).toBe(403);
    actAs(outsider);
    expect((await call(remind.POST, { method: "POST", body: { kind: "day", date: TODAY } })).status).toBe(403);
  });
});

describe("reading it back", () => {
  it("colours each day by what happened", async () => {
    const grid = await dailyStatusGrid([ana.id, ben.id], "2026-06-07", TODAY, TODAY);
    const statuses = (id: number) => grid.get(id)!.map((c) => c.status);
    // Sunday off; Monday nobody wrote or auto-submitted (the app only
    // catches up one day back); then what happened above.
    expect(statuses(ana.id)).toEqual(["off", "missing", "submitted", "submitted"]);
    expect(statuses(ben.id)).toEqual(["off", "missing", "auto", "auto"]);
    expect(grid.get(ben.id)!.find((c) => c.date === TODAY)!.reminded).toBeGreaterThanOrEqual(1);
  });

  it("puts a person's updates, work and record on one profile", async () => {
    const p = await getPersonProfile(admin, ana.id, TODAY, TODAY);
    expect(p?.day).toMatchObject({ date: TODAY, status: "submitted", locked: false });
    expect(p?.day.entry?.progress).toBe("Fitted");
    expect(p?.week.entry?.plan).toBe("Ship it");
    expect(p?.days).toHaveLength(30);
    expect(p?.projects.map((x) => x.name)).toContain("Work updates project");
  });

  it("keeps the reminder settings to admins", async () => {
    actAs(lead);
    expect((await call(settingsRoute.GET, {})).status).toBe(403);
    actAs(admin);
    const saved = await call<{ settings: { dailyReminder: { time: string } } }>(settingsRoute.PUT, {
      method: "PUT",
      body: { settings: { dailyReminder: { on: true, time: "17:30" } } },
    });
    expect(saved.body.settings.dailyReminder.time).toBe("17:30");
    // Put it back for anything that runs after.
    await call(settingsRoute.PUT, { method: "PUT", body: { settings: {} } });
  });
});
