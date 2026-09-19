import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIcs, escapeIcsText, foldIcsLine, parseUtc } from "@/lib/ics";
import { googleCalendarUrl, outlookCalendarUrl, webcalUrl } from "@/lib/calendar-links";
import { isSafeVideoUrl, meetingRoomUrl, meetingsAppUrl, newRoomId } from "@/lib/video";

describe("iCalendar output", () => {
  it("escapes the characters the format reserves", () => {
    expect(escapeIcsText("Plan A; B, C\\D\nnext")).toBe("Plan A\\; B\\, C\\\\D\\nnext");
  });

  it("folds long lines and never splits a character", () => {
    const folded = foldIcsLine("SUMMARY:" + "é".repeat(100));
    const [first, ...rest] = folded.split("\r\n");
    expect(Buffer.from(first, "utf8").length).toBeLessThanOrEqual(75);
    expect(rest.every((l) => l.startsWith(" "))).toBe(true);
    // Unfolding restores the original text.
    expect(folded.replace(/\r\n /g, "")).toBe("SUMMARY:" + "é".repeat(100));
  });

  it("builds a timed event with a reminder", () => {
    const ics = buildIcs(
      [
        {
          uid: "meeting-7@pmapp",
          summary: "Sprint review",
          start: parseUtc("2026-09-18 09:30:00"),
          end: parseUtc("2026-09-18 10:00:00"),
          location: "https://meetings.example.test/meeting/pm-x",
          description: "Agenda; notes",
          alarmMinutesBefore: 30,
        },
      ],
      { name: "PMApp — Asha", now: new Date("2026-09-18T00:00:00Z") }
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("X-WR-CALNAME:PMApp — Asha");
    expect(ics).toContain("UID:meeting-7@pmapp");
    expect(ics).toContain("DTSTART:20260918T093000Z");
    expect(ics).toContain("DTEND:20260918T100000Z");
    expect(ics).toContain("DESCRIPTION:Agenda\\; notes");
    expect(ics).toContain("TRIGGER:-PT30M");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    // CRLF line endings throughout (RFC 5545).
    expect(ics.split("\n").every((l) => l === "" || l.endsWith("\r"))).toBe(true);
  });

  it("builds an all-day event that ends the next day", () => {
    const ics = buildIcs([{ uid: "task-3@pmapp", summary: "Due: Ship it", date: "2026-09-18" }]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260918");
    expect(ics).toContain("DTEND;VALUE=DATE:20260919");
    expect(ics).not.toContain("BEGIN:VALARM");
  });

  it("reads stored UTC values", () => {
    expect(parseUtc("2026-09-18 09:30:00").toISOString()).toBe("2026-09-18T09:30:00.000Z");
  });
});

describe("add-to-calendar links", () => {
  const entry = {
    title: "Sprint review",
    start: new Date("2026-09-18T09:30:00Z"),
    end: new Date("2026-09-18T10:00:00Z"),
    details: "Agenda",
    location: "Room 2",
  };

  it("builds a Google Calendar link", () => {
    const url = new URL(googleCalendarUrl(entry));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("dates")).toBe("20260918T093000Z/20260918T100000Z");
    expect(url.searchParams.get("text")).toBe("Sprint review");
  });

  it("builds an Outlook link", () => {
    const url = new URL(outlookCalendarUrl(entry));
    expect(url.hostname).toBe("outlook.office.com");
    expect(url.searchParams.get("startdt")).toBe("2026-09-18T09:30:00.000Z");
    expect(url.searchParams.get("subject")).toBe("Sprint review");
  });

  it("turns a feed URL into a subscription link", () => {
    expect(webcalUrl("https://pm.example.test/api/calendar/feed/abc")).toBe(
      "webcal://pm.example.test/api/calendar/feed/abc"
    );
  });
});

describe("video call links", () => {
  const original = process.env.MEETINGS_APP_URL;
  afterEach(() => {
    process.env.MEETINGS_APP_URL = original;
    vi.unstubAllEnvs();
  });

  it("points at the configured meetings app", () => {
    process.env.MEETINGS_APP_URL = "https://meetings.example.test/";
    expect(meetingsAppUrl()).toBe("https://meetings.example.test");
    expect(meetingRoomUrl("pm-review-abc123")).toBe(
      "https://meetings.example.test/meeting/pm-review-abc123"
    );
  });

  it("makes readable, unique room ids", () => {
    const id = newRoomId("Sprint Review — Q3!");
    expect(id).toMatch(/^pm-sprint-review-q3-[a-z0-9]{6}$/);
    expect(newRoomId("Sprint Review")).not.toBe(newRoomId("Sprint Review"));
    expect(newRoomId("")).toMatch(/^pm-meeting-[a-z0-9]{6}$/);
  });

  it("accepts only http(s) links", () => {
    expect(isSafeVideoUrl("https://zoom.us/j/123")).toBe(true);
    expect(isSafeVideoUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeVideoUrl("not a url")).toBe(false);
    expect(isSafeVideoUrl(`https://x.test/${"a".repeat(500)}`)).toBe(false);
  });
});

describe("subscribe links for each calendar service", () => {
  const feed = "https://pm.example.test/api/calendar/feed/abc123";

  it("prefills Google Calendar's add-by-URL screen", async () => {
    const { googleSubscribeUrl } = await import("@/lib/calendar-links");
    const url = new URL(googleSubscribeUrl(feed));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/r");
    expect(url.searchParams.get("cid")).toBe("webcal://pm.example.test/api/calendar/feed/abc123");
  });

  it("prefills Outlook's subscribe-from-web screen", async () => {
    const { outlookSubscribeUrl } = await import("@/lib/calendar-links");
    const work = new URL(outlookSubscribeUrl(feed, "PMApp — Asha"));
    expect(work.origin + work.pathname).toBe("https://outlook.office.com/calendar/0/addfromweb");
    expect(work.searchParams.get("url")).toBe("webcal://pm.example.test/api/calendar/feed/abc123");
    expect(work.searchParams.get("name")).toBe("PMApp — Asha");

    // Personal accounts live on a different host.
    expect(outlookSubscribeUrl(feed, "PMApp", { personal: true })).toContain(
      "https://outlook.live.com/calendar/0/addfromweb"
    );
  });
});

describe("the feed address itself", () => {
  it("ends in .ics, because calendar apps judge by the extension", async () => {
    const { calendarFeedUrl } = await import("@/lib/calendar-links");
    expect(calendarFeedUrl("https://pm.example.test", "a".repeat(32))).toBe(
      `https://pm.example.test/api/calendar/feed/${"a".repeat(32)}.ics`
    );
    // A trailing slash on the configured base must not double up.
    expect(calendarFeedUrl("https://pm.example.test/", "b".repeat(32))).toBe(
      `https://pm.example.test/api/calendar/feed/${"b".repeat(32)}.ics`
    );
  });

  it("says so when the address is one only this machine can reach", async () => {
    const { feedUrlProblem } = await import("@/lib/calendar-links");
    for (const bad of [
      "http://localhost:3000/api/calendar/feed/x.ics",
      "http://127.0.0.1:3000/api/calendar/feed/x.ics",
      "https://192.168.1.20/api/calendar/feed/x.ics",
      "https://10.0.0.5/api/calendar/feed/x.ics",
      "https://172.20.3.4/api/calendar/feed/x.ics",
      "https://pm-server/api/calendar/feed/x.ics",
      "https://pm.local/api/calendar/feed/x.ics",
    ]) {
      expect(feedUrlProblem(bad), bad).toMatch(/only works on this machine|isn’t a valid/);
    }
  });

  it("insists on https, which Google and Outlook require", async () => {
    const { feedUrlProblem } = await import("@/lib/calendar-links");
    expect(feedUrlProblem("http://pm.example.test/api/calendar/feed/x.ics")).toMatch(
      /plain http/
    );
  });

  it("passes a real public address", async () => {
    const { feedUrlProblem } = await import("@/lib/calendar-links");
    expect(feedUrlProblem("https://projectmanager.example.in/api/calendar/feed/x.ics")).toBeNull();
    // 172.x outside the private 16–31 range is ordinary public space.
    expect(feedUrlProblem("https://172.32.0.1/api/calendar/feed/x.ics")).toBeNull();
  });
});

describe("links inside calendar entries", () => {
  it("keeps a link intact — a URI is not escaped like text", () => {
    const ics = buildIcs([
      {
        uid: "meeting-9@pmapp",
        summary: "Review",
        start: parseUtc("2026-09-18 09:30:00"),
        url: "https://meet.example.test/j/abc?a=1,2&b=x;y",
        location: "https://meet.example.test/j/abc?a=1,2&b=x;y",
      },
    ]);
    // The URL line is byte-for-byte the link…
    expect(ics).toContain("URL:https://meet.example.test/j/abc?a=1,2&b=x;y");
    // …while the same value as a text property is escaped.
    expect(ics).toContain("LOCATION:https://meet.example.test/j/abc?a=1\\,2&b=x\\;y");
  });
});
