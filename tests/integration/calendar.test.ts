import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { query, DbRow, DbResult } from "@/lib/db";
import type { Meeting, User } from "@/lib/types";
import { actAs, call, createLedProject, createUser } from "./helpers";
import { mailerConfigured, sendCalendarInvite } from "@/lib/mailer";

import * as calendarToken from "@/app/api/calendar/token/route";
import * as calendarFeed from "@/app/api/calendar/feed/[token]/route";
import * as calendarCheck from "@/app/api/calendar/check/route";
import * as meetings from "@/app/api/meetings/route";
import * as meetingIcs from "@/app/api/meetings/[id]/ics/route";
import * as taskIcs from "@/app/api/tasks/[id]/ics/route";
import * as profile from "@/app/api/profile/route";

// Calendar subscriptions, video meetings and the profile fields behind
// WhatsApp alerts.

type Json = Record<string, unknown> & { error?: string; url?: string };

let lead: User, sam: User, outsider: User;
let projectId: number;
let taskId: number;
let meeting: Meeting;

const START = "2026-12-02T10:30";

beforeAll(async () => {
  process.env.MEETINGS_APP_URL = "https://meetings.example.test";
  process.env.APP_BASE_URL = "https://pm.example.test";

  lead = await createUser("Calead");
  sam = await createUser("Casam");
  outsider = await createUser("Caout");
  projectId = await createLedProject(lead, "Calendar project");
  await query(`INSERT INTO project_members (project_id, user_id) VALUES (?, ?)`, [projectId, sam.id]);

  const task = (await query<DbResult>(
    `INSERT INTO tasks (project_id, title, assignee_id, created_by, requested_by, request_approved_by, due_date)
     VALUES (?, 'Ship the dealer portal', ?, ?, ?, ?, '2026-12-05')`,
    [projectId, lead.id, lead.id, lead.id, lead.id]
  )) as unknown as DbResult;
  taskId = task.insertId;

  await query(
    `INSERT INTO reminders (user_id, title, notes, scheduled_at, reminder_minutes)
     VALUES (?, 'Renew the domain', 'Before it lapses', '2026-12-03 04:00:00', 30)`,
    [lead.id]
  );

  actAs(lead);
  const res = await call<{ meeting: Meeting }>(meetings.POST, {
    method: "POST",
    body: {
      title: "Sprint review",
      description: "Demo; then planning",
      projectId,
      startTime: START,
      durationMinutes: 45,
      reminderMinutes: 30,
      video: "room",
      attendeeIds: [sam.id],
    },
  });
  expect(res.status).toBe(201);
  meeting = res.body.meeting;
});

describe("video meetings", () => {
  it("creates a room in the meetings app", () => {
    expect(meeting.video_room_id).toMatch(/^pm-sprint-review-[a-z0-9]{6}$/);
    expect(meeting.video_url).toBe(`https://meetings.example.test/meeting/${meeting.video_room_id}`);
    expect(meeting.duration_minutes).toBe(45);
  });

  it("accepts a link the organizer already has, and rejects a bad one", async () => {
    actAs(lead);
    const pasted = await call<{ meeting: Meeting }>(meetings.POST, {
      method: "POST",
      body: { title: "Vendor call", startTime: START, video: "link", videoUrl: "https://zoom.us/j/99" },
    });
    expect(pasted.status).toBe(201);
    expect(pasted.body.meeting.video_url).toBe("https://zoom.us/j/99");
    expect(pasted.body.meeting.video_room_id).toBeNull();

    const bad = await call<Json>(meetings.POST, {
      method: "POST",
      body: { title: "Bad link", startTime: START, video: "link", videoUrl: "javascript:alert(1)" },
    });
    expect(bad.status).toBe(400);

    const none = await call<{ meeting: Meeting }>(meetings.POST, {
      method: "POST",
      body: { title: "Desk catch-up", startTime: START, video: "none" },
    });
    expect(none.body.meeting.video_url).toBeNull();
  });
});

describe("calendar subscription feed", () => {
  let feedToken: string;

  it("hands out a private link, and can replace it", async () => {
    actAs(lead);
    const first = await call<Json>(calendarToken.POST, { method: "POST", body: {} });
    expect(first.status).toBe(200);
    expect(first.body.url).toMatch(
      /^https:\/\/pm\.example\.test\/api\/calendar\/feed\/[a-f0-9]{32}\.ics$/
    );

    const again = await call<Json>(calendarToken.POST, { method: "POST", body: {} });
    expect(again.body.url).toBe(first.body.url);

    const rotated = await call<Json>(calendarToken.POST, { method: "POST", body: { rotate: true } });
    expect(rotated.body.url).not.toBe(first.body.url);
    feedToken = String(rotated.body.token);
  });

  it("serves that person's meetings, task due dates and reminders", async () => {
    const res = await call(calendarFeed.GET, { params: { token: feedToken } });
    expect(res.status).toBe(200);
    expect(res.res.headers.get("content-type")).toContain("text/calendar");
    const ics = await res.res.text();

    expect(ics).toContain(`UID:meeting-${meeting.id}@pmapp`);
    expect(ics).toContain("SUMMARY:Sprint review");
    // The API stores the time it is given as UTC (the UI converts from IST).
    expect(ics).toContain("DTSTART:20261202T103000Z");
    expect(ics).toContain("DTEND:20261202T111500Z"); // +45 minutes
    expect(ics).toContain(`LOCATION:https://meetings.example.test/meeting/${meeting.video_room_id}`);
    expect(ics).toContain("TRIGGER:-PT30M");

    expect(ics).toContain(`UID:task-${taskId}@pmapp`);
    expect(ics).toContain("SUMMARY:Due: Ship the dealer portal");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261205");

    expect(ics).toContain("SUMMARY:Renew the domain");
  });

  it("records that a calendar app read the feed, and forgets it on reset", async () => {
    const readAt = async () =>
      (
        await query<DbRow[]>(
          `SELECT calendar_feed_fetched_at AS at FROM users WHERE id = ?`,
          [lead.id]
        )
      )[0].at;

    actAs(lead);
    // A new link is a different subscription, so any earlier evidence goes.
    const rotated = await call<Json>(calendarToken.POST, {
      method: "POST",
      body: { rotate: true },
    });
    feedToken = String(rotated.body.token);
    expect(await readAt()).toBeNull();

    await call(calendarFeed.GET, { params: { token: feedToken } });
    expect(await readAt()).not.toBeNull();
  });

  it("answers the same whether or not the link ends in .ics", async () => {
    const bare = await call(calendarFeed.GET, { params: { token: feedToken } });
    const dotIcs = await call(calendarFeed.GET, { params: { token: `${feedToken}.ics` } });
    expect(dotIcs.status).toBe(200);
    expect(await dotIcs.res.text()).toContain("SUMMARY:Sprint review");
    expect(bare.status).toBe(200); // links handed out before the change still work
  });

  it("shows nothing to an unknown or stale link", async () => {
    expect((await call(calendarFeed.GET, { params: { token: "nope" } })).status).toBe(404);
    expect((await call(calendarFeed.GET, { params: { token: "nope.ics" } })).status).toBe(404);
    expect(
      (await call(calendarFeed.GET, { params: { token: "0".repeat(32) } })).status
    ).toBe(404);
  });

  it("keeps one person's entries out of another's feed", async () => {
    actAs(outsider);
    const mine = await call<Json>(calendarToken.POST, { method: "POST", body: {} });
    const token = String(mine.body.token);
    const ics = await (await call(calendarFeed.GET, { params: { token } })).res.text();
    expect(ics).not.toContain("Sprint review");
    expect(ics).not.toContain("Ship the dealer portal");
    expect(ics).toContain("BEGIN:VCALENDAR");
  });
});

describe("single-entry calendar files", () => {
  it("gives attendees the meeting, and refuses everyone else", async () => {
    actAs(sam);
    const invited = await call(meetingIcs.GET, { id: meeting.id });
    expect(invited.status).toBe(200);
    const ics = await invited.res.text();
    expect(ics).toContain("SUMMARY:Sprint review");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(invited.res.headers.get("content-disposition")).toContain(`meeting-${meeting.id}.ics`);

    actAs(outsider);
    expect((await call(meetingIcs.GET, { id: meeting.id })).status).toBe(403);
  });

  it("gives project members the task due date", async () => {
    actAs(sam);
    const res = await call(taskIcs.GET, { id: taskId });
    expect(res.status).toBe(200);
    expect(await res.res.text()).toContain("DTSTART;VALUE=DATE:20261205");

    actAs(outsider);
    expect((await call(taskIcs.GET, { id: taskId })).status).toBe(403);

    const undated = (await query<DbResult>(
      `INSERT INTO tasks (project_id, title, created_by) VALUES (?, 'No due date', ?)`,
      [projectId, lead.id]
    )) as unknown as DbResult;
    actAs(lead);
    expect((await call(taskIcs.GET, { id: undated.insertId })).status).toBe(400);
  });
});

describe("WhatsApp opt-in on the profile", () => {
  it("saves a number and the choice, and rejects nonsense", async () => {
    actAs(sam);
    const ok = await call(profile.PATCH, {
      method: "PATCH",
      body: { name: sam.name, phone: "+91 98765 43210", whatsappOptIn: true },
    });
    expect(ok.status).toBe(200);
    const [row] = await query<DbRow[]>(`SELECT phone, whatsapp_opt_in FROM users WHERE id = ?`, [sam.id]);
    expect(row).toMatchObject({ phone: "+91 98765 43210", whatsapp_opt_in: 1 });

    const bad = await call<Json>(profile.PATCH, {
      method: "PATCH",
      body: { name: sam.name, phone: "12" },
    });
    expect(bad.status).toBe(400);
  });

  it("turns the alerts off when the number is removed", async () => {
    actAs(sam);
    const res = await call(profile.PATCH, {
      method: "PATCH",
      body: { name: sam.name, phone: "", whatsappOptIn: true },
    });
    expect(res.status).toBe(200);
    const [row] = await query<DbRow[]>(`SELECT phone, whatsapp_opt_in FROM users WHERE id = ?`, [sam.id]);
    expect(row).toMatchObject({ phone: null, whatsapp_opt_in: 0 });
  });
});

describe("the public feed is rate limited", () => {
  it("stops a client hammering it", async () => {
    // Its own client address, so the budget is this test's alone.
    const from = { "x-forwarded-for": "203.0.113.9" };
    actAs(lead);
    const { body } = await call<Json>(calendarToken.POST, { method: "POST", body: {} });
    const token = String(body.token);

    for (let i = 0; i < 60; i++) {
      const res = await call(calendarFeed.GET, { params: { token }, headers: from });
      expect(res.status).toBe(200);
    }
    const blocked = await call(calendarFeed.GET, { params: { token }, headers: from });
    expect(blocked.status).toBe(429);
    expect(blocked.res.headers.get("retry-after")).toBeTruthy();
  });
});

describe("“check it works” explains a subscription that never fills in", () => {
  beforeAll(async () => {
    actAs(sam);
    await call(calendarToken.POST, { method: "POST", body: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.APP_BASE_URL = "https://pm.example.test";
  });

  /** Stand in for the server fetching its own feed. */
  function answerWith(body: string, status = 200) {
    return vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(body, { status }) as never);
  }

  it("confirms a reachable feed and counts what is in it", async () => {
    actAs(sam);
    answerWith("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
    const { body } = await call<Json>(calendarCheck.GET);
    expect(body.ok).toBe(true);
    expect(body.events).toBe(1);
    expect(body.message).toContain("Working");
  });

  it("names the real cause when the feed is still behind the login", async () => {
    actAs(sam);
    answerWith('{"error":"Not authenticated"}', 401);
    const { body } = await call<Json>(calendarCheck.GET);
    expect(body.ok).toBe(false);
    expect(body.message).toContain("older build");
  });

  it("catches a proxy that serves a web page instead of a calendar", async () => {
    actAs(sam);
    answerWith("<!doctype html><title>Sign in</title>");
    const { body } = await call<Json>(calendarCheck.GET);
    expect(body.ok).toBe(false);
    expect(body.message).toContain("web page instead of a calendar");
  });

  it("rejects a localhost address without even trying to fetch it", async () => {
    actAs(sam);
    process.env.APP_BASE_URL = "http://localhost:3000";
    const spy = answerWith("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    const { body } = await call<Json>(calendarCheck.GET);
    expect(body.ok).toBe(false);
    expect(body.message).toContain("only works on this machine");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the feed carries exactly the meetings no invitation reached", () => {
  let token: string;

  beforeAll(async () => {
    actAs(lead);
    const { body } = await call<Json>(calendarToken.POST, { method: "POST", body: {} });
    token = String(body.token);
  });

  afterEach(async () => {
    vi.mocked(mailerConfigured).mockReturnValue(false);
    vi.mocked(sendCalendarInvite).mockResolvedValue(false);
    await query(`UPDATE meetings SET invite_sent_at = NULL WHERE id = ?`, [meeting.id]);
  });

  const feed = async (t: string) =>
    (await call(calendarFeed.GET, { params: { token: t } })).res.text();

  it("drops a meeting once its invitation has really been emailed", async () => {
    // Nothing was emailed, so the feed is the only way this meeting reaches
    // a calendar.
    expect(await feed(token)).toContain("SUMMARY:Sprint review");

    // The invitation went out: it put itself in their calendar, and
    // repeating it here would show the same meeting twice.
    await query(`UPDATE meetings SET invite_sent_at = UTC_TIMESTAMP() WHERE id = ?`, [
      meeting.id,
    ]);
    const after = await feed(token);
    expect(after).not.toContain("SUMMARY:Sprint review");
    // Due dates and reminders are still the feed's job — nobody wants an
    // email invitation for every deadline.
    expect(after).toContain("Due: Ship the dealer portal");
    expect(after).toContain("SUMMARY:Renew the domain");
  });

  it("keeps a meeting mail was configured for but never sent", async () => {
    // The production failure this exists for: SES is set up, the sender is
    // not verified, every send fails. Judging by configuration alone put the
    // meeting in no calendar at all.
    vi.mocked(mailerConfigured).mockReturnValue(true);
    expect(await feed(token)).toContain("SUMMARY:Sprint review");
  });

  it("gives every meeting to someone with no email address", async () => {
    const noAddress = await createUser("Canomail");
    await query(`UPDATE users SET email = NULL WHERE id = ?`, [noAddress.id]);
    await query(
      `INSERT IGNORE INTO meeting_attendees (meeting_id, user_id) VALUES (?, ?)`,
      [meeting.id, noAddress.id]
    );
    await query(`UPDATE meetings SET invite_sent_at = UTC_TIMESTAMP() WHERE id = ?`, [
      meeting.id,
    ]);

    actAs(noAddress);
    const { body } = await call<Json>(calendarToken.POST, { method: "POST", body: {} });
    // No invitation can reach them, so the feed carries it however the
    // email went for everyone else.
    expect(await feed(String(body.token))).toContain("SUMMARY:Sprint review");
    actAs(lead);
  });

  it("records the send, so a meeting that was emailed leaves the feed", async () => {
    vi.mocked(mailerConfigured).mockReturnValue(true);
    vi.mocked(sendCalendarInvite).mockResolvedValue(true);

    actAs(lead);
    const res = await call<{ meeting: Meeting; invitationsEmailed: boolean }>(meetings.POST, {
      method: "POST",
      body: { title: "Emailed meeting", startTime: START, attendeeIds: [sam.id] },
    });
    expect(res.body.invitationsEmailed).toBe(true);
    const [row] = await query<DbRow[]>(
      `SELECT invite_sent_at FROM meetings WHERE id = ?`,
      [res.body.meeting.id]
    );
    expect(row.invite_sent_at).not.toBeNull();
    expect(await feed(token)).not.toContain("SUMMARY:Emailed meeting");

    await query(`DELETE FROM meetings WHERE id = ?`, [res.body.meeting.id]);
  });

  it("tells the organizer when nothing could be emailed", async () => {
    vi.mocked(mailerConfigured).mockReturnValue(true);
    vi.mocked(sendCalendarInvite).mockResolvedValue(false);

    actAs(lead);
    const res = await call<{ meeting: Meeting; invitationsEmailed: boolean }>(meetings.POST, {
      method: "POST",
      body: { title: "Unsent meeting", startTime: START, attendeeIds: [sam.id] },
    });
    expect(res.body.invitationsEmailed).toBe(false);
    expect(await feed(token)).toContain("SUMMARY:Unsent meeting");

    await query(`DELETE FROM meetings WHERE id = ?`, [res.body.meeting.id]);
  });
});
