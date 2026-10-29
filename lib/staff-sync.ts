import "server-only";
import { query, DbRow } from "./db";
import { attendancePool } from "./attendance";

/**
 * lib/staff-sync.ts — keeps PM's staff list in step with Attendance.
 *
 * Attendance decides who works here. PM re-reads a person's status when they
 * sign in or load a page, but someone who has left never does either, so
 * without this sweep they would stay on every list for good. The sweep checks
 * everyone: whoever Attendance no longer has, or has switched off, is retired
 * (inactive, with the date PM noticed); whoever comes back is restored. Nothing
 * is deleted — tasks, comments and history stay with their names on them.
 *
 * It refuses to act on an answer that looks wrong rather than retire the
 * whole company: an empty roster, or one that would retire most people at
 * once, is held for an admin to confirm (Team › Retired › Check now).
 */

export interface PmPerson {
  id: number;
  employee_id: number;
  name: string;
  is_active: boolean | number;
  retired_at?: string | null;
}

export interface RosterEntry {
  id: number;
  is_active: boolean | number;
}

export interface StaffChange {
  userId: number;
  name: string;
  change: "retire" | "return";
  /** Why they are retired; null for a return. */
  reason: "removed" | "deactivated" | null;
}

/** What the sweep would change, given both lists. Pure. */
export function planStaffSync(people: PmPerson[], roster: RosterEntry[]): StaffChange[] {
  const byId = new Map(roster.map((e) => [Number(e.id), e]));
  const changes: StaffChange[] = [];
  for (const p of people) {
    const emp = byId.get(Number(p.employee_id));
    const working = Boolean(emp?.is_active);
    if (!working && (p.is_active || !p.retired_at)) {
      changes.push({ userId: p.id, name: p.name, change: "retire", reason: emp ? "deactivated" : "removed" });
    } else if (working && !p.is_active) {
      changes.push({ userId: p.id, name: p.name, change: "return", reason: null });
    }
  }
  return changes;
}

/**
 * Whether retiring this many at once looks like a bad roster rather than real
 * leavers: more than half of the people currently working, and more than a
 * handful.
 */
export function looksLikeBadRoster(retiring: number, activeNow: number): boolean {
  return retiring > 5 && retiring > activeNow / 2;
}

export interface StaffSyncResult {
  at: string;
  retired: StaffChange[];
  returned: StaffChange[];
  /** Set when nothing was changed on purpose, and why. */
  held: string | null;
}

/** The whole employee roster, read from Attendance. Throws if unreachable. */
export async function fetchAttendanceRoster(): Promise<RosterEntry[]> {
  const [rows] = await attendancePool.query(`SELECT id, is_active FROM employees`);
  return (Array.isArray(rows) ? rows : []) as RosterEntry[];
}

const LAST_RUN_KEY = "staff_sync_last";

/**
 * Check everyone against Attendance and retire or restore as needed.
 * `force` applies a change the guard would hold (an admin confirmed it).
 * `roster` is for tests; it defaults to reading Attendance.
 */
export async function syncStaffWithAttendance(
  opts: { force?: boolean; roster?: () => Promise<RosterEntry[]> } = {}
): Promise<StaffSyncResult> {
  const at = new Date().toISOString();
  const result: StaffSyncResult = { at, retired: [], returned: [], held: null };

  let roster: RosterEntry[];
  try {
    roster = await (opts.roster ?? fetchAttendanceRoster)();
  } catch (err) {
    console.error("[staff-sync] attendance unavailable:", (err as Error).message);
    result.held = "Attendance could not be reached, so nobody was changed.";
    return result;
  }

  if (!roster.length) {
    result.held = "Attendance returned no employees, so nobody was changed.";
  } else {
    const people = (await query<DbRow[]>(
      `SELECT id, employee_id, name, is_active, retired_at FROM users`
    )) as unknown as PmPerson[];
    const changes = planStaffSync(people, roster);
    const retiring = changes.filter((c) => c.change === "retire");
    const newlyGone = retiring.filter((c) => people.find((p) => p.id === c.userId)?.is_active);
    const activeNow = people.filter((p) => p.is_active).length;

    if (!opts.force && looksLikeBadRoster(newlyGone.length, activeNow)) {
      result.held =
        `Attendance would retire ${newlyGone.length} of ${activeNow} current people at once. ` +
        `Nobody was changed — check Attendance, then confirm here if it is right.`;
    } else {
      for (const c of changes) {
        if (c.change === "retire") {
          await query(
            `UPDATE users SET is_active = 0, retired_at = COALESCE(retired_at, NOW()), retired_reason = ?
              WHERE id = ?`,
            [c.reason, c.userId]
          );
        } else {
          await query(
            `UPDATE users SET is_active = 1, retired_at = NULL, retired_reason = NULL WHERE id = ?`,
            [c.userId]
          );
        }
      }
      result.retired = newlyGone;
      result.returned = changes.filter((c) => c.change === "return");
    }
  }

  await query(
    `INSERT INTO app_settings (setting_key, value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [LAST_RUN_KEY, JSON.stringify(result)]
  );
  return result;
}

/** The last sweep's outcome, for the Retired tab. */
export async function lastStaffSync(): Promise<StaffSyncResult | null> {
  const [row] = await query<DbRow[]>(
    `SELECT value FROM app_settings WHERE setting_key = ? LIMIT 1`,
    [LAST_RUN_KEY]
  );
  if (!row) return null;
  try {
    return JSON.parse(String(row.value)) as StaffSyncResult;
  } catch {
    return null;
  }
}

export interface RetiredPerson {
  id: number;
  emp_id: string;
  name: string;
  department: string | null;
  designation: string | null;
  retired_at: string | null;
  retired_reason: "removed" | "deactivated" | null;
  last_seen_at: string | null;
  open_tasks: number;
  owned_projects: number;
  led_projects: number;
}

/** Everyone retired, most recent first, with the work still in their name. */
export async function listRetired(): Promise<RetiredPerson[]> {
  const rows = await query<DbRow[]>(
    `SELECT u.id, u.emp_id, u.name, u.department, u.designation, u.retired_at, u.retired_reason,
            u.last_seen_at,
            (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id
              WHERE t.assignee_id = u.id AND t.status <> 'done' AND p.status = 'active') AS open_tasks,
            (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id AND p.status = 'active') AS owned_projects,
            (SELECT COUNT(*) FROM project_members pm JOIN projects p ON p.id = pm.project_id
              WHERE pm.user_id = u.id AND pm.role_in_project = 'lead' AND p.status = 'active') AS led_projects
       FROM users u
      WHERE u.is_active = 0
      ORDER BY u.retired_at IS NULL, u.retired_at DESC, u.name`
  );
  return rows.map((r) => ({
    ...(r as unknown as RetiredPerson),
    open_tasks: Number(r.open_tasks),
    owned_projects: Number(r.owned_projects),
    led_projects: Number(r.led_projects),
  }));
}
