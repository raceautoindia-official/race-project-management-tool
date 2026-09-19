import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import type { Meeting, User } from "@/lib/types";
import { actAs, call, createUser } from "./helpers";

import * as meetings from "@/app/api/meetings/route";

// Scheduling a meeting when the meetings app is (and isn't) connected.

let lead: User, sam: User;

const REMOTE = {
  meetingId: 5,
  roomId: "qrs-tuvw-xyz",
  joinUrl: "https://meetings.example.test/meeting/qrs-tuvw-xyz",
  accountsCreated: ["sam@example.test"],
};

beforeAll(async () => {
  process.env.MEETINGS_APP_URL = "https://meetings.example.test";
  lead = await createUser("Vlead");
  sam = await createUser("Vsam");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function schedule() {
  actAs(lead);
  return call<{ meeting: Meeting; videoWarning?: string | null }>(meetings.POST, {
    method: "POST",
    body: {
      title: "Connected review",
      startTime: "2026-12-09T11:00",
      durationMinutes: 60,
      video: "room",
      attendeeIds: [sam.id],
    },
  });
}

describe("meetings app integration", () => {
  it("schedules the meeting there and stores its room", async () => {
    vi.stubEnv("MEETINGS_API_KEY", "shared-secret");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(REMOTE)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await schedule();
    expect(res.status).toBe(201);
    expect(res.body.meeting.video_room_id).toBe(REMOTE.roomId);
    expect(res.body.meeting.video_url).toBe(REMOTE.joinUrl);
    expect(res.body.videoWarning).toBeNull();

    // The host and the invited member are sent with their email addresses.
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      title: "Connected review",
      durationMins: 60,
      scheduledAt: "2026-12-09T11:00:00Z",
      host: { name: lead.name, email: lead.email },
      invitees: [{ name: sam.name, email: sam.email }],
    });
  });

  it("still schedules, with a warning, when the meetings app is down", async () => {
    vi.stubEnv("MEETINGS_API_KEY", "shared-secret");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }));

    const res = await schedule();
    expect(res.status).toBe(201);
    // A usable link either way: the room is created when someone joins.
    expect(res.body.meeting.video_url).toMatch(
      /^https:\/\/meetings\.example\.test\/meeting\/pm-connected-review-[a-z0-9]{6}$/
    );
    expect(res.body.videoWarning).toMatch(/couldn't be reached/);
  });

  it("just makes a room link when the integration isn't configured", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(REMOTE)));
    vi.stubGlobal("fetch", fetchMock);

    const res = await schedule();
    expect(res.status).toBe(201);
    expect(res.body.meeting.video_url).toContain("/meeting/pm-connected-review-");
    expect(res.body.videoWarning).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("organizer without an email address", () => {
  it("says why the meeting could not be scheduled in the meetings app", async () => {
    vi.stubEnv("MEETINGS_API_KEY", "shared-secret");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(REMOTE)));
    vi.stubGlobal("fetch", fetchMock);

    const noEmail = await createUser("Vnoemail");
    await query(`UPDATE users SET email = NULL WHERE id = ?`, [noEmail.id]);
    actAs(noEmail);
    const res = await call<{ meeting: Meeting; videoWarning?: string | null }>(meetings.POST, {
      method: "POST",
      body: { title: "No email meeting", startTime: "2026-12-09T11:00", video: "room" },
    });

    expect(res.status).toBe(201);
    expect(res.body.videoWarning).toMatch(/no email address/);
    expect(res.body.meeting.video_url).toContain("/meeting/pm-no-email-meeting-");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
