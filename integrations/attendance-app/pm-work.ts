/**
 * Read someone's PM App work — for the Attendance app (worklens).
 *
 * Copy this file into the Attendance app, not into PM. It calls PM's
 * /api/integrations/employee-work endpoint with the shared key.
 *
 * SERVER SIDE ONLY. The key must never reach a browser: anyone who views the
 * page source would then be able to read every employee's workload. In Next.js
 * that means a server component, a route handler, or getServerSideProps —
 * never a "use client" component.
 */

export interface PmTask {
  id: number;
  title: string;
  project: string;
  status: "todo" | "in_progress" | "review";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  overdue: boolean;
  url: string;
}

export interface PmWork {
  empId: string;
  /** False when this employee has never signed in to PM. */
  known: boolean;
  name?: string;
  openCount: number;
  dueTodayCount: number;
  overdueCount: number;
  loggedTodayMinutes: number;
  tasks: PmTask[];
  url?: string;
}

/** What a caller gets when PM is unreachable — never an exception. */
const NOTHING: PmWork = {
  empId: "",
  known: false,
  openCount: 0,
  dueTodayCount: 0,
  overdueCount: 0,
  loggedTodayMinutes: 0,
  tasks: [],
};

/**
 * One employee's open PM work.
 *
 * Returns an empty result rather than throwing, for any failure: PM being
 * down, slow, or misconfigured must never stop someone clocking in. A missing
 * panel is a small loss; a check-in screen that will not load is a real one.
 */
export async function fetchPmWork(empId: string): Promise<PmWork> {
  const base = (process.env.PM_APP_URL || "").replace(/\/+$/, "");
  const key = process.env.PM_INTEGRATION_KEY || "";
  if (!base || !key || !empId) return { ...NOTHING, empId };

  try {
    const res = await fetch(
      `${base}/api/integrations/employee-work?empId=${encodeURIComponent(empId)}`,
      {
        headers: { "x-integration-key": key },
        // The check-in screen must stay fast: give up rather than hang.
        signal: AbortSignal.timeout(4000),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      console.warn(`[pm-work] PM answered ${res.status} for ${empId}`);
      return { ...NOTHING, empId };
    }
    return (await res.json()) as PmWork;
  } catch (err) {
    console.warn("[pm-work] PM unreachable:", (err as Error).message);
    return { ...NOTHING, empId };
  }
}

/** "1h 30m" — minutes are how it arrives; nobody reads in minutes. */
export function formatMinutes(total: number): string {
  const m = Math.max(0, Math.round(total));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}
