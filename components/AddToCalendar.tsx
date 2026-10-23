"use client";

import { googleCalendarUrl, outlookCalendarUrl } from "@/lib/calendar-links";

/**
 * "Add to calendar" for one entry: Google and Outlook open a prefilled event;
 * Apple Calendar (and any desktop app) uses the .ics download.
 */
export default function AddToCalendar({
  title,
  start,
  end,
  details,
  location,
  icsHref,
  compact = false,
}: {
  title: string;
  /** Stored UTC value, "YYYY-MM-DD HH:MM:SS". */
  start: string;
  /** Minutes; ignored when the entry is a whole day. */
  durationMinutes?: number;
  end?: string;
  details?: string | null;
  location?: string | null;
  icsHref: string;
  compact?: boolean;
}) {
  const startDate = new Date(`${start.replace(" ", "T")}Z`);
  const endDate = end ? new Date(`${end.replace(" ", "T")}Z`) : new Date(startDate.getTime() + 30 * 60_000);
  const entry = { title, start: startDate, end: endDate, details, location };
  const item =
    "block px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50";

  return (
    <details className="group relative">
      <summary
        className={`cursor-pointer list-none rounded-lg border border-slate-200 font-medium text-slate-600 hover:bg-slate-50 ${
          compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm"
        }`}
      >
        📅 Add to calendar
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
        <a className={item} href={googleCalendarUrl(entry)} target="_blank" rel="noopener noreferrer">
          Google Calendar
        </a>
        <a className={item} href={outlookCalendarUrl(entry)} target="_blank" rel="noopener noreferrer">
          Outlook / Microsoft 365
        </a>
        <a className={item} href={icsHref} download>
          Apple Calendar / other (.ics)
        </a>
      </div>
    </details>
  );
}
