import { describe, expect, it } from "vitest";
import { buildInvite } from "@/lib/ics";
import { buildInviteMime } from "@/lib/mailer";

/**
 * What separates an invitation from an attachment is METHOD plus the
 * ORGANIZER/ATTENDEE pair. Gmail and Outlook read those to decide whether to
 * put the meeting in someone's calendar by itself, so they are worth pinning
 * down.
 */

const base = {
  uid: "meeting-42@pmapp",
  summary: "Sprint review",
  start: new Date("2026-12-02T10:30:00Z"),
  end: new Date("2026-12-02T11:15:00Z"),
  organizer: { name: "Lee Lead", email: "lee@example.test" },
  attendees: [
    { name: "Sam Owner", email: "sam@example.test" },
    { name: "Asha Admin", email: "asha@example.test" },
  ],
  now: new Date("2026-11-30T09:00:00Z"),
};

describe("a meeting invitation", () => {
  it("is a REQUEST addressed to each guest, from the organizer", () => {
    const ics = buildInvite({ ...base, method: "REQUEST" });

    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:meeting-42@pmapp");
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("DTSTART:20261202T103000Z");
    expect(ics).toContain("DTEND:20261202T111500Z");
    expect(ics).toContain("ORGANIZER;CN=Lee Lead:mailto:lee@example.test");

    // Each guest is asked to reply, which is what shows Yes/No/Maybe.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("RSVP=TRUE;CN=Sam Owner:mailto:sam@example.test");
    expect(unfolded).toContain("RSVP=TRUE;CN=Asha Admin:mailto:asha@example.test");
    expect(unfolded).toContain("PARTSTAT=NEEDS-ACTION");
  });

  it("cancels under the same UID, so the entry is removed and not duplicated", () => {
    const ics = buildInvite({ ...base, method: "CANCEL" });

    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("UID:meeting-42@pmapp");
    expect(ics).toContain("STATUS:CANCELLED");
    // A higher SEQUENCE is what makes a client accept it as an update.
    expect(ics).toContain("SEQUENCE:1");
    // No point reminding someone about a meeting that is off.
    expect(ics).not.toContain("BEGIN:VALARM");
  });

  it("carries the join link as the location, where calendars show it", () => {
    const ics = buildInvite({
      ...base,
      method: "REQUEST",
      location: "https://meetings.example.test/meeting/pm-sprint-review-ab12cd",
      url: "https://meetings.example.test/meeting/pm-sprint-review-ab12cd",
      alarmMinutesBefore: 30,
    });
    const unfolded = ics.replace(/\r\n /g, "");

    expect(unfolded).toContain(
      "LOCATION:https://meetings.example.test/meeting/pm-sprint-review-ab12cd"
    );
    // A URI is not text-escaped — escaping it is what breaks the link.
    expect(unfolded).not.toContain("https\\://");
    expect(ics).toContain("TRIGGER:-PT30M");
  });

  it("cannot be used to inject extra lines through a name or address", () => {
    const ics = buildInvite({
      ...base,
      method: "REQUEST",
      summary: "Review\nEND:VEVENT",
      organizer: { name: "Lee\nLead", email: "lee@example.test\nBEGIN:VEVENT" },
      attendees: [{ name: "Sam", email: "sam@example.test" }],
    });

    // One event, whatever people type. What matters is the structural lines:
    // the injected text survives escaped *inside* a value, which is correct.
    const lines = ics.split("\r\n");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(1);
    expect(ics).toContain("SUMMARY:Review\\nEND:VEVENT");
    // The address loses its newline *and* its colon — a colon there would
    // break the parameter/value split even without a line break. Unfolded,
    // because a long ORGANIZER line wraps.
    expect(ics.replace(/\r\n /g, "")).toContain("mailto:lee@example.testBEGINVEVENT");
  });

  it("stays valid when a name needs folding", () => {
    const ics = buildInvite({
      ...base,
      method: "REQUEST",
      attendees: [{ name: "A".repeat(120), email: "long@example.test" }],
    });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.from(line, "utf8").length).toBeLessThanOrEqual(75);
    }
    expect(ics.replace(/\r\n /g, "")).toContain(`CN=${"A".repeat(120)}:mailto:long@example.test`);
  });
});

describe("the email that carries an invitation", () => {
  const mime = (over: Record<string, unknown> = {}) =>
    buildInviteMime({
      to: ["sam@example.test", "asha@example.test"],
      from: "alerts@example.test",
      fromName: "Lee Lead",
      subject: "Invitation: Sprint review",
      html: "<p>Sprint review</p>",
      text: "Sprint review",
      ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
      method: "REQUEST",
      boundaries: { alt: "ALT", mixed: "MIX" },
      ...over,
    });

  it("declares the calendar part as an invitation, not an attachment", () => {
    const raw = mime();
    // This exact header is what makes Gmail and Outlook offer Yes/No/Maybe.
    expect(raw).toContain('Content-Type: text/calendar; charset="UTF-8"; method=REQUEST');
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="ALT"');
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="MIX"');
  });

  it("closes every boundary it opens", () => {
    const raw = mime();
    expect(raw).toContain("--ALT--");
    expect(raw).toContain("--MIX--");
    // Three alternatives (plain, html, calendar) plus the closing marker.
    expect(raw.split("--ALT").length - 1).toBe(4);
  });

  it("offers plain text and HTML as well, for clients that want them", () => {
    const raw = mime();
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw).toContain('Content-Type: text/html; charset="UTF-8"');
    // Bodies are base64, wrapped so no line runs away.
    for (const line of raw.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
  });

  it("attaches the same calendar as a file, for Apple Mail", () => {
    const raw = mime();
    expect(raw).toContain('Content-Disposition: attachment; filename="invite.ics"');
    const encoded = Buffer.from("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", "utf8").toString("base64");
    expect(raw.split(encoded).length - 1).toBe(2); // inline part + attachment
  });

  it("encodes a subject that isn't plain ASCII", () => {
    expect(mime({ subject: "Invitation: Planning – Q1" })).toContain("Subject: =?UTF-8?B?");
    expect(mime()).toContain("Subject: Invitation: Sprint review");
  });

  it("cannot have extra headers injected through the subject", () => {
    const raw = mime({ subject: "Hi\r\nBcc: sneak@evil.test" });
    // The text survives, flattened onto the Subject line — what must not
    // happen is a line of its own, which is what a header actually is.
    expect(raw.split("\r\n").some((l) => l.startsWith("Bcc:"))).toBe(false);
    expect(raw).toContain("Subject: Hi Bcc: sneak@evil.test");
  });

  it("says CANCEL when withdrawing one", () => {
    expect(mime({ method: "CANCEL" })).toContain("method=CANCEL");
  });
});
