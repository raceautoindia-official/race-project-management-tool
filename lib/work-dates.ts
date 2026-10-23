import { istDateKey } from "./tz";

/**
 * Today's date in India (YYYY-MM-DD). Due dates, start dates and schedule
 * health are calendar days in IST, wherever the server or browser runs.
 */
export function todayIST(): string {
  // istDateKey takes the stored "YYYY-MM-DD HH:MM:SS" UTC form.
  return istDateKey(new Date().toISOString().slice(0, 19).replace("T", " "));
}
