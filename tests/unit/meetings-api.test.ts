import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRemoteMeeting, meetingsApiConfigured } from "@/lib/video";

const OK = {
  meetingId: 12,
  roomId: "abc-defg-hij",
  joinUrl: "https://meetings.example.test/meeting/abc-defg-hij",
  accountsCreated: ["sam@e2e.local"],
};

function stubFetch(response: Response) {
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

const input = {
  title: "Sprint review",
  scheduledAt: "2026-12-02 10:30:00",
  durationMins: 45,
  host: { name: "Lee Lead", email: "lee@e2e.local" },
  invitees: [
    { name: "Sam Owner", email: "sam@e2e.local" },
    { name: "No Email", email: null },
  ],
};

describe("creating a meeting in the meetings app", () => {
  beforeEach(() => {
    vi.stubEnv("MEETINGS_APP_URL", "https://meetings.example.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is skipped until the shared key is configured", async () => {
    stubFetch(new Response(JSON.stringify(OK)));
    expect(meetingsApiConfigured()).toBe(false);
    expect(await createRemoteMeeting(input)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the host, invitees and time, and returns the room", async () => {
    vi.stubEnv("MEETINGS_API_KEY", "shared-secret");
    stubFetch(new Response(JSON.stringify(OK)));

    expect(meetingsApiConfigured()).toBe(true);
    await expect(createRemoteMeeting(input)).resolves.toEqual({
      roomId: OK.roomId,
      joinUrl: OK.joinUrl,
      accountsCreated: OK.accountsCreated,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://meetings.example.test/api/integrations/meetings");
    expect((init.headers as Record<string, string>)["x-integration-key"]).toBe("shared-secret");
    expect(JSON.parse(String(init.body))).toEqual({
      title: "Sprint review",
      // Stored UTC becomes an explicit instant for the other app.
      scheduledAt: "2026-12-02T10:30:00Z",
      durationMins: 45,
      host: { name: "Lee Lead", email: "lee@e2e.local" },
      invitees: [{ name: "Sam Owner", email: "sam@e2e.local" }],
    });
  });

  it("gives up quietly when the meetings app refuses or is unreachable", async () => {
    vi.stubEnv("MEETINGS_API_KEY", "shared-secret");

    stubFetch(new Response('{"error":"Unauthorized"}', { status: 401 }));
    expect(await createRemoteMeeting(input)).toBeNull();

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }));
    expect(await createRemoteMeeting(input)).toBeNull();

    // A success response that is missing the room is not usable either.
    stubFetch(new Response('{"ok":true}'));
    expect(await createRemoteMeeting(input)).toBeNull();
  });

  it("needs the host's email address", async () => {
    vi.stubEnv("MEETINGS_API_KEY", "shared-secret");
    stubFetch(new Response(JSON.stringify(OK)));
    expect(
      await createRemoteMeeting({ ...input, host: { name: "Lee", email: null } })
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
