import "server-only";
import { buildInvite, parseUtc, type InvitePerson } from "./ics";
import { appBaseUrl, emailLayout, escapeHtml, sendCalendarInvite } from "./mailer";
import { formatIst } from "./tz";

/**
 * Meeting invitations by email.
 *
 * A subscription feed is opt-in: each person has to add it once. An
 * invitation isn't — Gmail and Outlook put it in the recipient's calendar on
 * arrival, which is what people expect from a meeting. So meetings travel as
 * invitations, and the feed carries the things no one wants an email about:
 * task due dates and reminders.
 */

export interface MeetingForInvite {
  id: number;
  title: string;
  description?: string | null;
  /** UTC "YYYY-MM-DD HH:MM:SS" as stored. */
  startTime: string | Date;
  durationMinutes?: number | null;
  location?: string | null;
  videoUrl?: string | null;
  reminderMinutes?: number | null;
  projectName?: string | null;
}

/** Shared by the invitation and its cancellation, so clients match them up. */
export function meetingUid(meetingId: number): string {
  return `meeting-${meetingId}@pmapp`;
}

function detailLines(m: MeetingForInvite, when: string): string[] {
  return [
    `When: ${when} (IST)`,
    m.projectName ? `Project: ${m.projectName}` : null,
    m.videoUrl ? `Join: ${m.videoUrl}` : m.location ? `Where: ${m.location}` : null,
    m.description ? `\n${m.description}` : null,
  ].filter(Boolean) as string[];
}

/**
 * Send the invitation (or its cancellation) to everyone with an email
 * address. Returns the number of recipients it went to — 0 when email is
 * switched off or nobody has an address, which is never an error: the
 * meeting itself is already saved.
 */
export async function sendMeetingInvite(
  meeting: MeetingForInvite,
  organizer: InvitePerson,
  attendees: InvitePerson[],
  method: "REQUEST" | "CANCEL" = "REQUEST"
): Promise<number> {
  const recipients = attendees.filter(
    (a) => a.email && a.email.includes("@") && a.email !== organizer.email
  );
  if (recipients.length === 0 || !organizer.email) return 0;

  const start = parseUtc(meeting.startTime as string);
  const end = new Date(start.getTime() + Number(meeting.durationMinutes ?? 30) * 60_000);
  const when = formatIst(
    typeof meeting.startTime === "string"
      ? meeting.startTime
      : meeting.startTime.toISOString()
  );
  const base = appBaseUrl();
  const cancelling = method === "CANCEL";

  const ics = buildInvite({
    uid: meetingUid(meeting.id),
    summary: meeting.title,
    start,
    end,
    description: detailLines(meeting, when).join("\n"),
    location: meeting.videoUrl ?? meeting.location ?? null,
    url: meeting.videoUrl ?? `${base}/meetings`,
    alarmMinutesBefore: meeting.reminderMinutes ?? null,
    organizer,
    attendees: recipients,
    method,
  });

  const title = cancelling ? `Cancelled: ${meeting.title}` : meeting.title;
  const intro = cancelling
    ? `${escapeHtml(organizer.name)} cancelled this meeting.`
    : `${escapeHtml(organizer.name)} invited you to this meeting.`;

  const html = emailLayout(
    title,
    `<p>${intro}</p>
     <p><strong>${escapeHtml(meeting.title)}</strong><br>${escapeHtml(when)} (IST)</p>
     ${meeting.projectName ? `<p>Project: ${escapeHtml(meeting.projectName)}</p>` : ""}
     ${
       meeting.videoUrl && !cancelling
         ? `<p><a href="${escapeHtml(meeting.videoUrl)}">Join the video call</a></p>`
         : meeting.location
           ? `<p>Where: ${escapeHtml(meeting.location)}</p>`
           : ""
     }
     ${meeting.description ? `<p>${escapeHtml(meeting.description)}</p>` : ""}
     <p><a href="${base}/meetings">See it in PMApp</a></p>`
  );

  const text = [
    cancelling
      ? `${organizer.name} cancelled this meeting.`
      : `${organizer.name} invited you to this meeting.`,
    "",
    meeting.title,
    ...detailLines(meeting, when),
    "",
    `${base}/meetings`,
  ].join("\n");

  const sent = await sendCalendarInvite({
    to: recipients.map((r) => r.email),
    subject: cancelling ? `Cancelled: ${meeting.title}` : `Invitation: ${meeting.title}`,
    html,
    text,
    ics,
    method,
    fromName: organizer.name,
    // A reply to an invitation belongs with whoever called the meeting.
    replyTo: organizer.email,
  });

  return sent ? recipients.length : 0;
}
