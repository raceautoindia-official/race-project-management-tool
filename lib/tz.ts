// Timezone + duration helpers. The app is used in India (IST, Asia/Kolkata).
// Datetimes are STORED in UTC (MySQL "YYYY-MM-DD HH:MM:SS") and DISPLAYED in IST.

const IST_OFFSET_MIN = 330; // +05:30

/** Parse a stored UTC datetime string ("YYYY-MM-DD HH:MM:SS") into a Date. */
function parseUtc(s: string): Date {
  return new Date(s.replace(" ", "T") + "Z");
}

/** Format a stored-UTC datetime as IST, e.g. "11 Jul 2026, 2:00 PM". */
export function formatIst(utc: string): string {
  if (!utc) return "";
  return parseUtc(utc).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Time-only IST, e.g. "2:00 PM". */
export function formatIstTime(utc: string): string {
  if (!utc) return "";
  return parseUtc(utc).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** IST date key ("YYYY-MM-DD") for a stored-UTC datetime — for calendar bucketing. */
export function istDateKey(utc: string): string {
  const d = parseUtc(utc);
  // en-CA yields ISO YYYY-MM-DD.
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** IST 24-hour time ("HH:mm") — for compact, sortable calendar display. */
export function istTime24(utc: string): string {
  if (!utc) return "";
  return parseUtc(utc).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Convert a browser <input type="datetime-local"> value ("YYYY-MM-DDTHH:mm"),
 * entered as IST wall-clock, into a UTC datetime string for storage.
 */
export function istInputToUtc(local: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return local;
  const [, y, mo, d, hh, mm] = m.map(Number) as unknown as number[];
  const utcMs = Date.UTC(y, mo - 1, d, hh, mm) - IST_OFFSET_MIN * 60_000;
  return new Date(utcMs).toISOString().slice(0, 19).replace("T", " ");
}

/** Format a duration given in hours (decimal) as "Xh Ym" / "Ym" / "Xh". */
export function formatHM(hours: number | string | null | undefined): string {
  const h = Number(hours ?? 0);
  const totalMin = Math.round(h * 60);
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  if (hh === 0 && mm === 0) return "0h";
  if (hh === 0) return `${mm}m`;
  if (mm === 0) return `${hh}h`;
  return `${hh}h ${mm}m`;
}

/** Format a duration given in whole minutes as "Xh Ym". */
export function formatMinutes(minutes: number): string {
  return formatHM(minutes / 60);
}
