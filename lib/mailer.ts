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

const REGION = process.env.SES_REGION ?? process.env.AWS_REGION ?? "";
const ACCESS = process.env.SES_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? "";
const SECRET =
  process.env.SES_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "";
const FROM = process.env.SES_FROM_EMAIL ?? "";

export function mailerConfigured(): boolean {
  return Boolean(REGION && ACCESS && SECRET && FROM);
}

let _client: SESv2Client | null = null;
function client(): SESv2Client | null {
  if (!mailerConfigured()) return null;
  if (!_client) {
    _client = new SESv2Client({
      region: REGION,
      credentials: { accessKeyId: ACCESS, secretAccessKey: SECRET },
    });
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
        FromEmailAddress: FROM,
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
