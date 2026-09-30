// Video calls run in the company meetings app (Race Innovations Video Calling
// & Chat). A room link is all we need: the meetings app creates the room when
// the first person joins, and sends signed-out people through its own login
// and back to the room.

/** Base URL of the meetings app, without a trailing slash. */
export function meetingsAppUrl(): string {
  return (process.env.MEETINGS_APP_URL ?? "https://meetings.raceinnovations.in").replace(/\/+$/, "");
}

/** Join link for a room id. */
export function meetingRoomUrl(roomId: string): string {
  return `${meetingsAppUrl()}/meeting/${encodeURIComponent(roomId)}`;
}

/** A room id from the meeting title: readable, unique, URL-safe. */
export function newRoomId(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `pm-${slug || "meeting"}-${suffix}`;
}

/** Only absolute http(s) links are accepted from users. */
export function isSafeVideoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && url.length <= 500;
  } catch {
    return false;
  }
}

export interface RemoteMeetingPerson {
  name: string;
  email: string | null;
}

export interface RemoteMeeting {
  roomId: string;
  joinUrl: string;
  /** Meetings-app accounts created for people who had none. */
  accountsCreated: string[];
}

/** True when this server can create meetings in the meetings app directly. */
export function meetingsApiConfigured(): boolean {
  return Boolean(process.env.MEETINGS_API_KEY);
}

/**
 * Schedule the meeting in the meetings app itself, so it appears there with
 * its host, time and invited people (and they get accounts if they had none).
 *
 * Returns null when the integration isn't configured or the call fails — the
 * caller then falls back to a plain room link, which still works because the
 * meetings app creates a room the first time someone joins.
 */
export async function createRemoteMeeting(input: {
  title: string;
  /** UTC "YYYY-MM-DD HH:MM:SS" as stored, or null for an instant meeting. */
  scheduledAt: string | null;
  durationMins: number;
  host: RemoteMeetingPerson;
  invitees: RemoteMeetingPerson[];
}): Promise<RemoteMeeting | null> {
  const key = process.env.MEETINGS_API_KEY;
  if (!key || !input.host.email) return null;

  try {
    const res = await fetch(`${meetingsAppUrl()}/api/integrations/meetings`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-integration-key": key },
      body: JSON.stringify({
        title: input.title,
        scheduledAt: input.scheduledAt ? `${input.scheduledAt.replace(" ", "T")}Z` : null,
        durationMins: input.durationMins,
        host: input.host,
        invitees: input.invitees.filter((p) => p.email),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[meetings] create failed (${res.status}):`, (await res.text()).slice(0, 300));
      return null;
    }
    const data = (await res.json()) as Partial<RemoteMeeting>;
    if (!data.roomId || !data.joinUrl) return null;
    return {
      roomId: String(data.roomId),
      joinUrl: String(data.joinUrl),
      accountsCreated: data.accountsCreated ?? [],
    };
  } catch (err) {
    console.error("[meetings] create failed:", (err as Error).message);
    return null;
  }
}
