// "Add to calendar" links for Google and Outlook. Apple (and any desktop
// calendar) uses the .ics download instead. Pure — safe in client components.

export interface CalendarEntry {
  title: string;
  start: Date;
  end: Date;
  details?: string | null;
  location?: string | null;
}

function compact(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Google Calendar's prefilled "create event" page. */
export function googleCalendarUrl(e: CalendarEntry): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${compact(e.start)}/${compact(e.end)}`,
  });
  if (e.details) params.set("details", e.details);
  if (e.location) params.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook / Microsoft 365 web calendar's prefilled "create event" page. */
export function outlookCalendarUrl(e: CalendarEntry): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: e.title,
    startdt: e.start.toISOString(),
    enddt: e.end.toISOString(),
  });
  if (e.details) params.set("body", e.details);
  if (e.location) params.set("location", e.location);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** The webcal:// form of a feed URL — clicking it subscribes in most apps. */
export function webcalUrl(httpUrl: string): string {
  return httpUrl.replace(/^https?:\/\//, "webcal://");
}

/**
 * Google Calendar's "add calendar by URL" screen, prefilled with a feed.
 * Google takes the feed in `cid`, and accepts the webcal:// form.
 */
export function googleSubscribeUrl(feedUrl: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(feedUrl))}`;
}

/**
 * Outlook's "subscribe from web" screen, prefilled with a feed.
 * `personal` targets outlook.live.com (personal accounts) instead of
 * outlook.office.com (work / Microsoft 365).
 */
export function outlookSubscribeUrl(
  feedUrl: string,
  name = "PMApp",
  opts: { personal?: boolean } = {}
): string {
  const host = opts.personal ? "outlook.live.com" : "outlook.office.com";
  const params = new URLSearchParams({ url: webcalUrl(feedUrl), name });
  return `https://${host}/calendar/0/addfromweb?${params.toString()}`;
}

/**
 * One person's subscription URL.
 *
 * The `.ics` ending means nothing to us — the route accepts the link with or
 * without it — but it matters to the calendar apps. Google and several desktop
 * clients decide how to treat a subscription partly from the file extension,
 * and quietly refuse URLs that end in something else.
 */
export function calendarFeedUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/calendar/feed/${token}.ics`;
}

/** Addresses that only resolve inside this machine or this office network. */
function isUnreachableHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") return true;
  if (host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // A bare machine name with no dots ("pm-server") only resolves on the LAN.
  if (!host.includes(".")) return true;
  return false;
}

/**
 * Why Google, Outlook or Apple would fail to fetch this feed, in plain words,
 * or null if the address looks like something they can reach.
 *
 * This is the one thing that catches people out: those calendars are fetched
 * by Google's and Microsoft's own servers, from the public internet — not by
 * the browser you are looking at. A link that opens perfectly in your browser
 * is still useless to them if it only resolves on this machine or this LAN.
 */
export function feedUrlProblem(feedUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(feedUrl);
  } catch {
    return "That isn’t a valid web address.";
  }
  const host = u.hostname.toLowerCase();
  if (isUnreachableHost(host)) {
    return `This link points at “${u.hostname}”, which only works on this machine or this office network. Google, Outlook and Apple fetch the feed from the internet, so set APP_BASE_URL to the public address staff type into their browser.`;
  }
  if (u.protocol !== "https:") {
    return "This link is plain http. Google and Outlook only subscribe over https — change APP_BASE_URL to the https address.";
  }
  return null;
}
