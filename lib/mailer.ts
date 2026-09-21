import "server-only";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { feedUrlProblem } from "./calendar-links";

/**
 * lib/mailer.ts — transactional email via AWS SES.
 *
 * Configured entirely from env:
 *   SES_REGION (or AWS_REGION), SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY,
 *   SES_FROM_EMAIL (a verified sender identity).
 *
 * If any of those are missing, the mailer is a no-op: it logs and returns
 * false instead of throwing, so the whole app (and the cron jobs) keep working
 * before SES credentials are supplied. Wire the creds and email lights up.
 */

// Read at call time, not at import: a module-level snapshot is taken before
// the environment is necessarily complete, and it makes the setting
// impossible to vary in a test.
const region = () => process.env.SES_REGION ?? process.env.AWS_REGION ?? "";
const access = () => process.env.SES_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? "";
const secret = () =>
  process.env.SES_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "";
const fromAddress = () => process.env.SES_FROM_EMAIL ?? "";

export function mailerConfigured(): boolean {
  return Boolean(region() && access() && secret() && fromAddress());
}

let _client: SESv2Client | null = null;
let _clientKey = "";
function client(): SESv2Client | null {
  if (!mailerConfigured()) return null;
  // Rebuild if the credentials changed under us.
  const key = `${region()}|${access()}`;
  if (!_client || _clientKey !== key) {
    _client = new SESv2Client({
      region: region(),
      credentials: { accessKeyId: access(), secretAccessKey: secret() },
    });
    _clientKey = key;
  }
  return _client;
}

export interface SendOptions {
  to: string | (string | null | undefined)[];
  subject: string;
  html: string;
  text?: string;
}

/** Send one email. Returns true if SES accepted it, false if skipped/failed. */
export async function sendEmail(opts: SendOptions): Promise<boolean> {
  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map((r) => (r ?? "").trim())
    .filter((r) => r.length > 0);
  const unique = Array.from(new Set(recipients));
  if (unique.length === 0) return false;

  const c = client();
  if (!c) {
    console.warn(
      `[mailer] SES not configured — skipped "${opts.subject}" → ${unique.join(", ")}`
    );
    return false;
  }

  try {
    await c.send(
      new SendEmailCommand({
        FromEmailAddress: fromAddress(),
        Destination: { ToAddresses: unique },
        Content: {
          Simple: {
            Subject: { Data: opts.subject, Charset: "UTF-8" },
            Body: {
              Html: { Data: opts.html, Charset: "UTF-8" },
              ...(opts.text
                ? { Text: { Data: opts.text, Charset: "UTF-8" } }
                : {}),
            },
          },
        },
      })
    );
    return true;
  } catch (err) {
    console.error("[mailer] SES send failed:", (err as Error).message);
    return false;
  }
}

/** Header text with anything that could inject another header removed. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** RFC 2047 for a subject that isn't plain ASCII (accents, emoji, …). */
function encodeHeader(value: string): string {
  const safe = headerSafe(value);
  if (/^[\x20-\x7e]*$/.test(safe)) return safe;
  return `=?UTF-8?B?${Buffer.from(safe, "utf8").toString("base64")}?=`;
}

/** Base64, wrapped at 76 characters as MIME requires. */
function base64Body(value: string): string {
  return (Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

export interface CalendarInviteOptions extends SendOptions {
  /** iCalendar text built with buildInvite(). */
  ics: string;
  /** Must match the METHOD inside `ics`. */
  method: "REQUEST" | "CANCEL";
  /** Shown as the sender's name; defaults to the organizer's own. */
  fromName?: string;
}

/**
 * Send a real calendar invitation, not a mail with a file attached.
 *
 * What makes Gmail and Outlook put the meeting straight into someone's
 * calendar — with Yes/No/Maybe, and no action needed from them — is a
 * `text/calendar; method=REQUEST` part inside multipart/alternative. SES's
 * Simple content can't express that, so this builds the MIME itself and
 * sends it raw. The .ics attachment alongside is for Apple Mail and other
 * clients that look for a file instead.
 */
export async function sendCalendarInvite(opts: CalendarInviteOptions): Promise<boolean> {
  const unique = Array.from(
    new Set(
      (Array.isArray(opts.to) ? opts.to : [opts.to])
        .map((r) => headerSafe(r ?? ""))
        .filter((r) => r.length > 0)
    )
  );
  if (unique.length === 0) return false;

  const c = client();
  if (!c) {
    console.warn(
      `[mailer] SES not configured — skipped invitation "${opts.subject}" → ${unique.length} recipient(s)`
    );
    return false;
  }

  const raw = buildInviteMime({ ...opts, to: unique, from: fromAddress() });

  try {
    await c.send(
      new SendEmailCommand({
        FromEmailAddress: fromAddress(),
        Destination: { ToAddresses: unique },
        Content: { Raw: { Data: Buffer.from(raw, "utf8") } },
      })
    );
    return true;
  } catch (err) {
    console.error("[mailer] SES invitation failed:", (err as Error).message);
    return false;
  }
}

/**
 * The MIME document behind an invitation. Exported so its shape can be
 * tested: a boundary typo or a missing header turns an invitation back into
 * an unreadable attachment, and nothing would tell us.
 */
export function buildInviteMime(opts: {
  to: string[];
  from: string;
  fromName?: string;
  subject: string;
  html: string;
  text?: string;
  ics: string;
  method: "REQUEST" | "CANCEL";
  /** Fixed boundaries, for tests. */
  boundaries?: { alt: string; mixed: string };
}): string {
  const alt = opts.boundaries?.alt ?? `alt-${Math.random().toString(36).slice(2)}`;
  const mixed = opts.boundaries?.mixed ?? `mix-${Math.random().toString(36).slice(2)}`;
  const from = opts.fromName
    ? `${encodeHeader(opts.fromName)} <${opts.from}>`
    : opts.from;
  const unique = opts.to;

  return [
    `From: ${from}`,
    `To: ${unique.join(", ")}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(opts.text ?? opts.subject),
    "",
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(opts.html),
    "",
    `--${alt}`,
    `Content-Type: text/calendar; charset="UTF-8"; method=${opts.method}`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(opts.ics),
    "",
    `--${alt}--`,
    "",
    `--${mixed}`,
    'Content-Type: application/ics; name="invite.ics"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="invite.ics"',
    "",
    base64Body(opts.ics),
    "",
    `--${mixed}--`,
    "",
  ].join("\r\n");
}

/** Escape user-supplied text for interpolation into email HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Wrap body content in a minimal, email-client-safe HTML shell. `title` is
 * plain text (escaped here); `bodyHtml` is HTML — escape user values in it
 * with escapeHtml().
 */
export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#4f46e5;color:#fff;padding:16px 24px;font-size:16px;font-weight:600;">${escapeHtml(title)}</div>
    <div style="padding:24px;color:#334155;font-size:14px;line-height:1.6;">${bodyHtml}</div>
    <div style="padding:16px 24px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;">
      Automated notification from PMApp. Please do not reply.
    </div>
  </div>
</body></html>`;
}

let warnedAboutBaseUrl = false;

/** Base URL for links inside emails and calendar subscriptions. */
export function appBaseUrl(): string {
  const url =
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3002";

  // Getting this wrong in production is silent and expensive: every link in
  // every notification email points at the wrong host, and calendar
  // subscriptions never fill in, because Google and Microsoft fetch those
  // from the internet. Nothing surfaces it, so say it once in the log.
  if (!warnedAboutBaseUrl && process.env.NODE_ENV === "production") {
    const problem = feedUrlProblem(url);
    if (problem) {
      warnedAboutBaseUrl = true;
      console.warn(`[config] APP_BASE_URL is "${url}" — ${problem}`);
    }
  }

  return url;
}
