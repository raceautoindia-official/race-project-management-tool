/**
 * The shape of a day's recorded work, and the two ways of saying it in
 * words. Kept out of lib/daily-summary.ts, which is server-only because it
 * reads the database: the page that displays a summary runs in the browser
 * and needs these.
 */

export interface SummaryTask {
  id: number;
  title: string;
  project_name: string | null;
  minutes: number;
  /** Follow-up work raised after the original was done — the extra. */
  is_additional: boolean;
}

export interface DailySummary {
  /** Tasks they logged time against, most time first. */
  worked: SummaryTask[];
  /** Tasks they finished that day. */
  completed: SummaryTask[];
  /** Extra work that landed on them that day, beyond what was planned. */
  extra: SummaryTask[];
  meetings: { id: number; title: string; at: string }[];
  comments: number;
  totalMinutes: number;
  /** True when the day has nothing on it at all. */
  empty: boolean;
}

/** "6h 30m", "45m", or "—" for nothing. */
export function formatMinutes(total: number): string {
  if (!total) return "—";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ");
}

/** One line: what the day amounted to, for a list or a spreadsheet cell. */
export function summaryLine(s: DailySummary): string {
  if (s.empty) return "";
  const parts = [
    s.worked.length
      ? `${s.worked.length} task${s.worked.length === 1 ? "" : "s"} (${formatMinutes(
          s.totalMinutes
        )})`
      : null,
    s.completed.length ? `${s.completed.length} finished` : null,
    s.extra.length ? `${s.extra.length} extra` : null,
    s.meetings.length
      ? `${s.meetings.length} meeting${s.meetings.length === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
