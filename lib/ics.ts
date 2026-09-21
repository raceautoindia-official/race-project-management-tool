// iCalendar (RFC 5545) output: subscription feeds and single-event downloads.
// Pure string building, so it is unit-testable without a database.

export interface IcsEvent {
  /** Stable per event — calendars update rather than duplicate on re-fetch. */
  uid: string;
  summary: string;
  /** Timed event (UTC). Use `date` instead for an all-day entry. */
  start?: Date;
  end?: Date;
  /** All-day event as "YYYY-MM-DD". */
  date?: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  /** Adds a reminder that many minutes before the start. */
  alarmMinutesBefore?: number | null;
  cancelled?: boolean;
}

/** Escape a text value: backslash, semicolon, comma and newlines (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold a content line to 75 octets, continuing with a leading space (§3.1). */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    // Never split a multi-byte character: step back to a lead byte.
    let end = Math.min(start + (parts.length === 0 ? 75 : 74), bytes.length);
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.join("\r\n ");
}

/** "2026-09-18 14:30:00" (UTC, as stored) → Date. */
export function parseUtc(sqlDateTime: string | Date): Date {
  if (sqlDateTime instanceof Date) return sqlDateTime;
  return new Date(String(sqlDateTime).replace(" ", "T").replace(/Z?$/, "Z"));
}

function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function dateOnly(isoDate: string): string {
  return isoDate.slice(0, 10).replace(/-/g, "");
}

/** Next day, for an all-day event's (exclusive) DTEND. */
function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

function eventLines(e: IcsEvent, now: Date): string[] {
  const lines = ["BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp(now)}`];
  if (e.date) {
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.date)}`, `DTEND;VALUE=DATE:${nextDay(e.date)}`);
  } else if (e.start) {
    lines.push(`DTSTART:${stamp(e.start)}`);
    lines.push(`DTEND:${stamp(e.end ?? new Date(e.start.getTime() + 30 * 60_000))}`);
  }
  lines.push(`SUMMARY:${escapeIcsText(e.summary)}`);
  if (e.description) lines.push(`DESCRIPTION:${escapeIcsText(e.description)}`);
  if (e.location) lines.push(`LOCATION:${escapeIcsText(e.location)}`);
  // A URI value takes no text escaping (RFC 5545 §3.3.13) — escaping a comma
  // in a link is what breaks it. Only line breaks have to go.
  if (e.url) lines.push(`URL:${e.url.replace(/[\r\n]+/g, "")}`);
  lines.push(`STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`);
  if (e.alarmMinutesBefore != null && e.alarmMinutesBefore > 0 && !e.date) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(e.summary)}`,
      `TRIGGER:-PT${Math.round(e.alarmMinutesBefore)}M`,
      "END:VALARM"
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

/**
 * A complete calendar. `name` is what Google/Outlook/Apple show for a
 * subscribed feed; `ttlMinutes` hints how often they should re-fetch it.
 */
export function buildIcs(
  events: IcsEvent[],
  opts: { name?: string; ttlMinutes?: number; now?: Date } = {}
): string {
  const now = opts.now ?? new Date();
  const ttl = opts.ttlMinutes ?? 60;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PMApp//Project Management//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  if (opts.name) {
    lines.push(`X-WR-CALNAME:${escapeIcsText(opts.name)}`, `NAME:${escapeIcsText(opts.name)}`);
  }
  lines.push(`X-PUBLISHED-TTL:PT${ttl}M`, `REFRESH-INTERVAL;VALUE=DURATION:PT${ttl}M`);
  for (const e of events) lines.push(...eventLines(e, now));
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

export interface InvitePerson {
  name: string;
  email: string;
}

export interface InviteInput {
  /** Stable across the invitation and its later cancellation. */
  uid: string;
  summary: string;
  start: Date;
  end: Date;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  alarmMinutesBefore?: number | null;
  organizer: InvitePerson;
  attendees: InvitePerson[];
  /** REQUEST invites; CANCEL withdraws an invitation already sent. */
  method: "REQUEST" | "CANCEL";
  now?: Date;
}

/** A mail address as iCalendar wants it, with anything dangerous stripped. */
function calAddress(email: string): string {
  return `mailto:${email.replace(/[\r\n\s;,:]+/g, "")}`;
}

/**
 * A calendar *invitation*, as opposed to the feed's read-only copy.
 *
 * The difference is METHOD plus an ORGANIZER and ATTENDEE list: with those,
 * Gmail and Outlook treat the mail as an invitation — putting it straight in
 * the recipient's own calendar with Yes/No/Maybe — instead of an attachment
 * they have to open. CANCEL removes it again, matched by the shared UID.
 *
 * SEQUENCE is 0 for the invitation and 1 for the cancellation, which is all
 * this app needs: a meeting here can be created and cancelled, never edited.
 */
export function buildInvite(input: InviteInput): string {
  const now = input.now ?? new Date();
  const cancelling = input.method === "CANCEL";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PMApp//Project Management//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.method}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(input.end)}`,
    `SEQUENCE:${cancelling ? 1 : 0}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    `ORGANIZER;CN=${escapeIcsText(input.organizer.name)}:${calAddress(input.organizer.email)}`,
  ];

  for (const a of input.attendees) {
    lines.push(
      `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;` +
        `CN=${escapeIcsText(a.name)}:${calAddress(a.email)}`
    );
  }

  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  if (input.url) lines.push(`URL:${input.url.replace(/[\r\n]+/g, "")}`);
  lines.push(`STATUS:${cancelling ? "CANCELLED" : "CONFIRMED"}`);

  // A cancelled event needs no reminder.
  if (!cancelling && input.alarmMinutesBefore != null && input.alarmMinutesBefore > 0) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(input.summary)}`,
      `TRIGGER:-PT${Math.round(input.alarmMinutesBefore)}M`,
      "END:VALARM"
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** A downloadable .ics response (single event) — opens in the desktop calendar. */
export function icsResponse(filename: string, body: string, download = true): Response {
  const safe = filename.replace(/[^\w.-]+/g, "-").slice(0, 80);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safe}"`,
      "Cache-Control": "no-store",
    },
  });
}
