import { query, DbRow } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { json, errorResponse, ApiError } from "@/lib/http";
import { appBaseUrl } from "@/lib/mailer";
import { calendarFeedUrl, feedUrlProblem } from "@/lib/calendar-links";
import { checkRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/** Give up rather than hang the page if the address does not answer. */
const TIMEOUT_MS = 8000;

export interface CalendarCheck {
  ok: boolean;
  /** What to tell the person, in their words, not ours. */
  message: string;
  /** Present when the feed answered: how many entries it contains. */
  events?: number;
  url?: string;
}

/**
 * GET /api/calendar/check — "why isn't my calendar updating?"
 *
 * Subscriptions fail silently: Google and Outlook show no error to the person
 * who added the link, they simply never fill in. This fetches the feed the way
 * they would — the server's own address, no cookies — and says what happened.
 *
 * It proves the address is real, unauthenticated and serving a calendar. It
 * cannot prove Google's servers can reach it from outside; only a public
 * address can do that, which is why the address itself is checked first.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const rl = checkRateLimit(`calendar-check:${user.id}`, 10);
    if (!rl.ok) {
      throw new ApiError(429, `Too many checks. Try again in ${rl.retryAfter}s.`);
    }

    const [row] = await query<DbRow[]>(
      `SELECT calendar_token FROM users WHERE id = ?`,
      [user.id]
    );
    const token = (row?.calendar_token as string | null) ?? null;
    if (!token) {
      return json<CalendarCheck>({
        ok: false,
        message: "Create your calendar link first, then check it.",
      });
    }

    const url = calendarFeedUrl(appBaseUrl(), token);

    const addressProblem = feedUrlProblem(url);
    if (addressProblem) {
      return json<CalendarCheck>({ ok: false, url, message: addressProblem });
    }

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { accept: "text/calendar" },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return json<CalendarCheck>({
        ok: false,
        url,
        message:
          "Nothing answered at that address. Check that the site is running there and that the address in APP_BASE_URL is the one staff use.",
      });
    }

    if (res.status === 401 || res.status === 403) {
      return json<CalendarCheck>({
        ok: false,
        url,
        message:
          "The feed asked for a login. Calendar apps send no password, so the subscription will stay empty — this usually means the server is running an older build, before /api/calendar/feed/ was made public.",
      });
    }
    if (!res.ok) {
      return json<CalendarCheck>({
        ok: false,
        url,
        message: `The feed answered ${res.status}. Calendar apps need a plain 200 with the calendar file.`,
      });
    }

    const body = await res.text();
    if (!body.trimStart().startsWith("BEGIN:VCALENDAR")) {
      return json<CalendarCheck>({
        ok: false,
        url,
        message:
          "That address returned a web page instead of a calendar — something in front of the app (a proxy or login page) is intercepting it.",
      });
    }

    const events = (body.match(/BEGIN:VEVENT/g) ?? []).length;
    return json<CalendarCheck>({
      ok: true,
      url,
      events,
      message: events
        ? `Working — the feed is reachable and has ${events} ${events === 1 ? "entry" : "entries"}. If a calendar app still looks empty, it hasn't refreshed yet; they check every few hours.`
        : "Working — the feed is reachable, but you have no upcoming meetings, due dates or reminders, so the calendar will look empty until you do.",
    });
  } catch (err) {
    return errorResponse(err);
  }
}
