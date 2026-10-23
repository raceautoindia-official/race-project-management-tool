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

describe("meeting invitations by email", () => {
  /**
   * The point of invitations is that nobody has to subscribe to anything:
   * the meeting lands in the guest's own calendar on arrival. These check
   * the routes actually send one, addressed to the right people.
   */
  async function withMailerSpy<T>(fn: (sent: ReturnType<typeof vi.fn>) => Promise<T>) {
    const sent = vi.fn().mockResolvedValue(true);
    const real = await vi.importActual<typeof import("@/lib/mailer")>("@/lib/mailer");
    vi.doMock("@/lib/mailer", () => ({ ...real, sendCalendarInvite: sent }));
    vi.resetModules();
    try {
      return await fn(sent);
    } finally {
      vi.doUnmock("@/lib/mailer");
      vi.resetModules();
    }
  }

  it("invites every guest when a meeting is created, and cancels on delete", async () => {
    await withMailerSpy(async (sent) => {
      const route = await import("@/app/api/meetings/route");
      const byId = await import("@/app/api/meetings/[id]/route");

      actAs(lead);
      const created = await call<{ meeting: Meeting }>(route.POST, {
        method: "POST",
        body: {
          title: "Invited review",
          startTime: "2026-12-11T09:30",
          durationMinutes: 45,
          video: "room",
          reminderMinutes: 30,
          attendeeIds: [sam.id],
        },
      });
      expect(created.status).toBe(201);

      expect(sent).toHaveBeenCalledTimes(1);
      const invite = sent.mock.calls[0][0];
      expect(invite.method).toBe("REQUEST");
      expect(invite.subject).toBe("Invitation: Invited review");
      // The guest, and the organizer too: they scheduled it here rather than
      // in their calendar app, so otherwise the one person certain to attend
      // is the only one whose calendar stays empty.
      expect(invite.to).toEqual([sam.email, lead.email]);
      // They are not asked to accept their own meeting, though.
      const unfolded = invite.ics.replace(/\r\n /g, "");
      expect(unfolded).toContain(`PARTSTAT=ACCEPTED;RSVP=FALSE;CN=${lead.name}`);
      expect(unfolded).toContain(`PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${sam.name}`);
      expect(invite.ics).toContain("METHOD:REQUEST");
      expect(invite.ics).toContain(`UID:meeting-${created.body.meeting.id}@pmapp`);
      expect(invite.ics).toContain("DTSTART:20261211T093000Z");
      expect(invite.ics).toContain("DTEND:20261211T101500Z"); // +45 minutes
      expect(invite.ics).toContain("TRIGGER:-PT30M");
      expect(invite.ics.replace(/\r\n /g, "")).toContain(`mailto:${sam.email}`);

      sent.mockClear();
      const deleted = await call(byId.DELETE, { id: created.body.meeting.id });
      expect(deleted.status).toBe(200);

      expect(sent).toHaveBeenCalledTimes(1);
      const cancel = sent.mock.calls[0][0];
      expect(cancel.method).toBe("CANCEL");
      expect(cancel.subject).toBe("Cancelled: Invited review");
      expect(cancel.to).toEqual([sam.email, lead.email]);
      // Same UID, so the entry is withdrawn rather than duplicated.
      expect(cancel.ics).toContain(`UID:meeting-${created.body.meeting.id}@pmapp`);
      expect(cancel.ics).toContain("STATUS:CANCELLED");
    });
  });

  it("still creates the meeting when the invitation cannot be sent", async () => {
    await withMailerSpy(async (sent) => {
      sent.mockRejectedValue(new Error("SES is down"));
      const route = await import("@/app/api/meetings/route");

      actAs(lead);
      const created = await call<{ meeting: Meeting }>(route.POST, {
        method: "POST",
        body: {
          title: "Mail is broken",
          startTime: "2026-12-12T09:30",
          video: "none",
          attendeeIds: [sam.id],
        },
      });

      // The meeting is what matters; the email is a courtesy.
      expect(created.status).toBe(201);
      expect(created.body.meeting.title).toBe("Mail is broken");
    });
  });
});
