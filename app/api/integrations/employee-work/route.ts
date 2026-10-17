import { NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { query, DbRow } from "@/lib/db";
import { json } from "@/lib/http";
import { appBaseUrl } from "@/lib/mailer";
import { checkRateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/employee-work?empId=RACE005
 *
 * What one person has on in PM, for the Attendance app to show on its
 * check-in screen: open tasks, what is due today, what is overdue, and how
 * much they have logged today.
 *
 * People open the Attendance app every morning; PM they open when they
 * remember. Putting the day's work where they already are is the point of
 * connecting the two.
 *
 * Read-only and authenticated by a shared key, the same arrangement as the
 * meetings app. No session is involved: the caller is a server, not a person.
 */

function keyMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Compare in constant time, and only when the lengths already match —
  // timingSafeEqual throws on a length mismatch.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const expected = process.env.INTEGRATION_API_KEY ?? "";
  if (!expected) {
    return json({ error: "Integration API is not configured" }, 503);
  }
  if (!keyMatches(req.headers.get("x-integration-key") ?? "", expected)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!checkRateLimit(`employee-work:${ip}`, 120).ok) {
    return json({ error: "Too many requests" }, 429);
  }

  const empId = (new URL(req.url).searchParams.get("empId") ?? "").trim();
  if (!empId) return json({ error: "empId is required" }, 400);

  const [user] = await query<DbRow[]>(
    `SELECT id, name FROM users WHERE emp_id = ? AND is_active = TRUE LIMIT 1`,
    [empId]
  );
  // Not an error: plenty of employees have never opened PM. The Attendance
  // app should simply show nothing rather than an error on its own screen.
  if (!user) {
    return json({ empId, known: false, tasks: [], openCount: 0, dueTodayCount: 0, overdueCount: 0, loggedTodayMinutes: 0 });
  }

  const userId = Number(user.id);
  const base = appBaseUrl();

  // Open work assigned to them, soonest deadline first. Signed-off tasks and
  // unapproved or archived projects are not work anyone can act on today.
  const tasks = await query<DbRow[]>(
    `SELECT t.id, t.title, t.status, t.priority, t.due_date, t.project_id, p.name AS project_name
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_id = ? AND t.signed_off_at IS NULL AND t.status <> 'done'
        AND p.approval_status = 'approved' AND p.status <> 'archived'
      ORDER BY t.due_date IS NULL, t.due_date,
               FIELD(t.priority, 'urgent', 'high', 'medium', 'low'), t.id
      LIMIT 25`,
    [userId]
  );

  const [logged] = await query<DbRow[]>(
    `SELECT COALESCE(SUM(minutes), 0) AS minutes
       FROM task_time_logs
      WHERE user_id = ?
        AND logged_at >= CONVERT_TZ(CONCAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')), ' 00:00:00'), '+05:30', '+00:00')`,
    [userId]
  );

  const todayIst = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const due = (t: DbRow) => (t.due_date ? String(t.due_date).slice(0, 10) : null);

  return json({
    empId,
    known: true,
    name: String(user.name),
    openCount: tasks.length,
    dueTodayCount: tasks.filter((t) => due(t) === todayIst).length,
    overdueCount: tasks.filter((t) => due(t) !== null && due(t)! < todayIst).length,
    loggedTodayMinutes: Number(logged?.minutes ?? 0),
    tasks: tasks.map((t) => ({
      id: Number(t.id),
      title: String(t.title),
      project: String(t.project_name),
      status: String(t.status),
      priority: String(t.priority ?? "medium"),
      dueDate: due(t),
      overdue: due(t) !== null && due(t)! < todayIst,
      url: `${base}/projects/${t.project_id ?? ""}`,
    })),
    url: `${base}/my-tasks`,
  });
}
