import "server-only";
import { query, DbRow, DbResult } from "./db";
import { notify } from "./activity";
import { sendEmail, emailLayout, appBaseUrl, escapeHtml } from "./mailer";
import { dailySummary } from "./daily-summary";
import { weekSummary } from "./week-summary";
import { summaryLine, weekLine } from "./planner-summary-shape";
import {
  describePeriod,
  isWorkDay,
  todayIst,
  updateStatus,
  weekStart,
  type PlannerPeriod,
  type UpdateStatus,
} from "./planner";

/**
 * lib/work-updates.ts — the work-update routine around the planner:
 *
 * - Everyone (not admins) owes a daily update Monday to Saturday, and a
 *   weekly plan and weekly summary each week.
 * - Reminders go out at the times an admin sets (in-app, push and email).
 * - At the end of the day the app submits whatever was not handed in, marked
 *   "auto", filling "how it went" from what the board recorded.
 * - A morning digest tells admins who left the app to write their day.
 *
 * One cron (POST /api/cron/work-updates, every 15 minutes) runs it all; each
 * job records itself in job_runs, so it happens once however often it fires.
 */

// ── Settings ───────────────────────────────────────────────────────────────

export interface Slot {
  on: boolean;
  /** "HH:MM", India time. */
  time: string;
}

export interface UpdateSettings {
  /** Monday–Saturday, if today's update isn't submitted. */
  dailyReminder: Slot;
  /** Monday, if the week has no plan. */
  weeklyPlanReminder: Slot;
  /** Saturday, if the week has no summary. */
  weeklySummaryReminder: Slot;
  /** When unsubmitted days (and on Saturday, weeks) are submitted. Always on. */
  autoSubmitTime: string;
  /** Morning email and notification to admins about yesterday. */
  adminDigest: Slot;
  /** Send reminders by email as well as in the app. */
  email: boolean;
}

export const DEFAULT_SETTINGS: UpdateSettings = {
  dailyReminder: { on: true, time: "18:00" },
  weeklyPlanReminder: { on: true, time: "10:00" },
  weeklySummaryReminder: { on: true, time: "17:00" },
  autoSubmitTime: "23:30",
  adminDigest: { on: true, time: "08:00" },
  email: true,
};

const SETTINGS_KEY = "work_updates";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Settings as stored, with anything missing or malformed taken from the defaults. */
export function mergeSettings(raw: unknown): UpdateSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const slot = (key: keyof UpdateSettings, def: Slot): Slot => {
    const v = (r[key] ?? {}) as Partial<Slot>;
    return {
      on: typeof v.on === "boolean" ? v.on : def.on,
      time: typeof v.time === "string" && TIME.test(v.time) ? v.time : def.time,
    };
  };
  return {
    dailyReminder: slot("dailyReminder", DEFAULT_SETTINGS.dailyReminder),
    weeklyPlanReminder: slot("weeklyPlanReminder", DEFAULT_SETTINGS.weeklyPlanReminder),
    weeklySummaryReminder: slot("weeklySummaryReminder", DEFAULT_SETTINGS.weeklySummaryReminder),
    // Before midnight, or the day would lock before it was submitted.
    autoSubmitTime:
      typeof r.autoSubmitTime === "string" && TIME.test(r.autoSubmitTime) && r.autoSubmitTime >= "12:00"
        ? r.autoSubmitTime
        : DEFAULT_SETTINGS.autoSubmitTime,
    adminDigest: slot("adminDigest", DEFAULT_SETTINGS.adminDigest),
    email: typeof r.email === "boolean" ? r.email : DEFAULT_SETTINGS.email,
  };
}

export async function getUpdateSettings(): Promise<UpdateSettings> {
  const [row] = await query<DbRow[]>(`SELECT value FROM app_settings WHERE setting_key = ? LIMIT 1`, [SETTINGS_KEY]);
  if (!row) return DEFAULT_SETTINGS;
  try {
    return mergeSettings(JSON.parse(String(row.value)));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveUpdateSettings(settings: unknown, userId: number): Promise<UpdateSettings> {
  const clean = mergeSettings(settings);
  await query(
    `INSERT INTO app_settings (setting_key, value, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by)`,
    [SETTINGS_KEY, JSON.stringify(clean), userId]
  );
  return clean;
}

/** The first day updates were asked for (set when the feature was installed). */
export async function trackingSince(): Promise<string | null> {
  const [row] = await query<DbRow[]>(`SELECT value FROM app_settings WHERE setting_key = 'work_updates_since' LIMIT 1`);
  return row ? String(row.value) : null;
}

// ── Who owes an update ─────────────────────────────────────────────────────

/** Everyone who writes updates: active people who aren't admins. */
export async function updatePeople(ids?: number[]): Promise<DbRow[]> {
  if (ids && !ids.length) return [];
  return query<DbRow[]>(
    `SELECT id, name, email FROM users
      WHERE is_active = 1 AND role <> 'admin' ${ids ? `AND id IN (${ids.map(() => "?").join(", ")})` : ""}
      ORDER BY name`,
    ids ?? []
  );
}

const ENTRY_COLUMNS = `user_id, period, DATE_FORMAT(entry_date, '%Y-%m-%d') AS entry_date, plan, progress,
  submitted_at, submission, updated_at`;

// ── Reminders ──────────────────────────────────────────────────────────────

export type ReminderKind = "day" | "week_plan" | "week_summary";

/** The entry a reminder is about: the day, or the week's Monday. */
export function reminderRef(kind: ReminderKind, date: string): string {
  return kind === "day" ? date : weekStart(date);
}

/**
 * Of `people`, those who still owe this: the day not submitted, the week
 * with no plan, or the week with no summary.
 */
export async function stillOwing(kind: ReminderKind, date: string, people: DbRow[]): Promise<DbRow[]> {
  if (!people.length) return [];
  const ref = reminderRef(kind, date);
  const period: PlannerPeriod = kind === "day" ? "day" : "week";
  const rows = await query<DbRow[]>(
    `SELECT ${ENTRY_COLUMNS} FROM planner_entries
      WHERE period = ? AND entry_date = ? AND user_id IN (${people.map(() => "?").join(", ")})`,
    [period, ref, ...people.map((p) => p.id)]
  );
  const byUser = new Map(rows.map((r) => [Number(r.user_id), r]));
  return people.filter((p) => {
    const e = byUser.get(Number(p.id));
    if (e?.submission) return false;
    if (kind === "day") return true;
    if (kind === "week_plan") return !e?.plan;
    return !e?.progress;
  });
}

const REMINDER_TEXT: Record<ReminderKind, (label: string) => string> = {
  day: (l) => `Your daily update for ${l} isn't submitted yet — it is submitted for you at the end of the day.`,
  week_plan: (l) => `Write your weekly plan for ${l}: what the week is really for.`,
  week_summary: (l) => `Write your weekly summary for ${l} — how the week went, in your own words.`,
};

/**
 * Remind each of `people` about one update, in the app (with a browser push)
 * and, if switched on, by email. Records every reminder. Returns how many.
 */
export async function sendReminders(
  kind: ReminderKind,
  date: string,
  people: DbRow[],
  sentBy: number | null,
  settings: UpdateSettings
): Promise<number> {
  const ref = reminderRef(kind, date);
  const period: PlannerPeriod = kind === "day" ? "day" : "week";
  const label = describePeriod(period, ref);
  const text = REMINDER_TEXT[kind](label);
  const link = kind === "day" ? `/planner?date=${ref}` : `/planner?period=week&date=${ref}`;
  for (const p of people) {
    await notify(Number(p.id), "update_reminder", text.slice(0, 255), link, { whatsapp: false });
    if (settings.email && p.email) {
      await sendEmail({
        to: [String(p.email)],
        subject: kind === "day" ? `Daily update for ${label}` : kind === "week_plan" ? `Weekly plan for ${label}` : `Weekly summary for ${label}`,
        html: emailLayout(
          "Work update reminder",
          `<p>Hi ${escapeHtml(String(p.name).split(" ")[0])},</p>
           <p>${escapeHtml(text)}</p>
           <p><a href="${appBaseUrl()}${link}">Open Work Updates →</a></p>`
        ),
      });
    }
    await query(`INSERT INTO update_reminders (user_id, kind, ref_date, sent_by) VALUES (?, ?, ?, ?)`, [
      p.id,
      kind,
      ref,
      sentBy,
    ]);
  }
  return people.length;
}

// ── Auto-submit ────────────────────────────────────────────────────────────

/**
 * Submit every unsubmitted daily update for `date`, marked "auto". What the
 * person wrote stays; an empty "how it went" is filled from the recorded day.
 */
export async function autoSubmitDay(date: string): Promise<number> {
  if (!isWorkDay(date)) return 0;
  // Nobody was asked for a day before submitting began.
  const since = await trackingSince();
  if (since && date < since) return 0;
  const owing = await stillOwing("day", date, await updatePeople());
  for (const p of owing) {
    const recorded = summaryLine(await dailySummary(Number(p.id), date)) || null;
    await query(
      `INSERT INTO planner_entries (user_id, period, entry_date, plan, progress, submitted_at, submission)
       VALUES (?, 'day', ?, NULL, ?, UTC_TIMESTAMP(), 'auto')
       ON DUPLICATE KEY UPDATE progress = COALESCE(progress, VALUES(progress)),
                               submitted_at = UTC_TIMESTAMP(), submission = 'auto'`,
      [p.id, date, recorded]
    );
  }
  return owing.length;
}

/** The same for the week that `date` falls in, from the recorded week. */
export async function autoSubmitWeek(date: string): Promise<number> {
  const monday = weekStart(date);
  const since = await trackingSince();
  if (since && monday < weekStart(since)) return 0;
  const people = await updatePeople();
  if (!people.length) return 0;
  const rows = await query<DbRow[]>(
    `SELECT user_id FROM planner_entries
      WHERE period = 'week' AND entry_date = ? AND submission IS NOT NULL`,
    [monday]
  );
  const done = new Set(rows.map((r) => Number(r.user_id)));
  const owing = people.filter((p) => !done.has(Number(p.id)));
  for (const p of owing) {
    const recorded = weekLine(await weekSummary(Number(p.id), monday)) || null;
    await query(
      `INSERT INTO planner_entries (user_id, period, entry_date, plan, progress, submitted_at, submission)
       VALUES (?, 'week', ?, NULL, ?, UTC_TIMESTAMP(), 'auto')
       ON DUPLICATE KEY UPDATE progress = COALESCE(progress, VALUES(progress)),
                               submitted_at = UTC_TIMESTAMP(), submission = 'auto'`,
      [p.id, monday, recorded]
    );
  }
  return owing.length;
}

// ── The schedule ───────────────────────────────────────────────────────────

/** "HH:MM" in India for an instant. */
export function istClock(now: Date): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(11, 16);
}

function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Claim a job for a day; false if it already ran. */
async function claim(job: string, runFor: string): Promise<boolean> {
  const res = (await query<DbResult>(`INSERT IGNORE INTO job_runs (job, run_for) VALUES (?, ?)`, [
    job,
    runFor,
  ])) as unknown as DbResult;
  return res.affectedRows > 0;
}

export interface JobReport {
  job: string;
  for: string;
  count: number;
}

/**
 * Everything that is due at `now`. Catches up a day the server was down for
 * (auto-submit for yesterday, last week's summary) so no day is left open.
 */
export async function runWorkUpdateJobs(now: Date = new Date()): Promise<JobReport[]> {
  const settings = await getUpdateSettings();
  const today = todayIst(now);
  const clock = istClock(now);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  const done: JobReport[] = [];
  const run = async (job: string, runFor: string, fn: () => Promise<number>) => {
    if (await claim(job, runFor)) done.push({ job, for: runFor, count: await fn() });
  };

  // Catch-up first: yesterday, and the week before this one (both long
  // over). On Sunday the week that just ended is over too.
  const yesterday = shiftDay(today, -1);
  if (isWorkDay(yesterday)) await run("day-auto-submit", yesterday, () => autoSubmitDay(yesterday));
  const lastWeek = weekStart(shiftDay(today, -7));
  await run("week-auto-submit", lastWeek, () => autoSubmitWeek(lastWeek));
  const thisWeek = weekStart(today);
  if (dow === 0 || (dow === 6 && clock >= settings.autoSubmitTime)) {
    await run("week-auto-submit", thisWeek, () => autoSubmitWeek(thisWeek));
  }

  if (isWorkDay(today)) {
    if (settings.dailyReminder.on && clock >= settings.dailyReminder.time && clock < settings.autoSubmitTime) {
      await run("day-reminder", today, async () =>
        sendReminders("day", today, await stillOwing("day", today, await updatePeople()), null, settings)
      );
    }
    if (clock >= settings.autoSubmitTime) await run("day-auto-submit", today, () => autoSubmitDay(today));
  }
  if (dow === 1 && settings.weeklyPlanReminder.on && clock >= settings.weeklyPlanReminder.time) {
    await run("week-plan-reminder", today, async () =>
      sendReminders("week_plan", today, await stillOwing("week_plan", today, await updatePeople()), null, settings)
    );
  }
  if (
    dow === 6 &&
    settings.weeklySummaryReminder.on &&
    clock >= settings.weeklySummaryReminder.time &&
    clock < settings.autoSubmitTime
  ) {
    await run("week-summary-reminder", today, async () =>
      sendReminders("week_summary", today, await stillOwing("week_summary", today, await updatePeople()), null, settings)
    );
  }
  // The morning after a working day: tell admins who left it to the app.
  if (settings.adminDigest.on && clock >= settings.adminDigest.time && isWorkDay(yesterday)) {
    await run("admin-digest", yesterday, () => sendAdminDigest(yesterday));
  }
  return done;
}

/** Email and notify admins: who was auto-submitted for `date`, and who wrote nothing at all. */
export async function sendAdminDigest(date: string): Promise<number> {
  const rows = await query<DbRow[]>(
    `SELECT u.name, e.plan, e.progress FROM planner_entries e JOIN users u ON u.id = e.user_id
      WHERE e.period = 'day' AND e.entry_date = ? AND e.submission = 'auto' AND u.is_active = 1
      ORDER BY u.name`,
    [date]
  );
  if (!rows.length) return 0;
  const label = describePeriod("day", date);
  const admins = await query<DbRow[]>(`SELECT id, email FROM users WHERE role = 'admin' AND is_active = 1`);
  const message = `${rows.length} ${rows.length === 1 ? "person" : "people"} didn't submit their update for ${label} — the app submitted it.`;
  const link = `/team?tab=updates&date=${date}`;
  const list = rows
    .map((r) => `<li>${escapeHtml(String(r.name))}${r.plan ? "" : " — wrote nothing"}</li>`)
    .join("");
  for (const a of admins) {
    await notify(Number(a.id), "update_digest", message.slice(0, 255), link, { whatsapp: false });
    if (a.email) {
      await sendEmail({
        to: [String(a.email)],
        subject: `Work updates for ${label}: ${rows.length} auto-submitted`,
        html: emailLayout("Work updates", `<p>${escapeHtml(message)}</p><ul>${list}</ul><p><a href="${appBaseUrl()}${link}">See everyone's updates →</a></p>`),
      });
    }
  }
  return admins.length;
}

// ── Reading it back ────────────────────────────────────────────────────────

export interface StatusCell {
  date: string;
  status: UpdateStatus;
  /** When the person submitted it, if they did. */
  submitted_at: string | null;
  reminded: number;
}

/** Each of `userIds` × each day from `from` to `to`, for the updates grid. */
export async function dailyStatusGrid(
  userIds: number[],
  from: string,
  to: string,
  today = todayIst()
): Promise<Map<number, StatusCell[]>> {
  const grid = new Map<number, StatusCell[]>();
  if (!userIds.length) return grid;
  const marks = userIds.map(() => "?").join(", ");
  const entries = await query<DbRow[]>(
    `SELECT ${ENTRY_COLUMNS} FROM planner_entries
      WHERE period = 'day' AND entry_date BETWEEN ? AND ? AND user_id IN (${marks})`,
    [from, to, ...userIds]
  );
  const reminders = await query<DbRow[]>(
    `SELECT user_id, DATE_FORMAT(ref_date, '%Y-%m-%d') AS ref_date, COUNT(*) AS n FROM update_reminders
      WHERE kind = 'day' AND ref_date BETWEEN ? AND ? AND user_id IN (${marks})
      GROUP BY user_id, ref_date`,
    [from, to, ...userIds]
  );
  const key = (u: unknown, d: unknown) => `${u}|${d}`;
  const entryAt = new Map(entries.map((e) => [key(e.user_id, e.entry_date), e]));
  const remindedAt = new Map(reminders.map((r) => [key(r.user_id, r.ref_date), Number(r.n)]));
  const since = await trackingSince();
  const days: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) days.push(d);
  for (const id of userIds) {
    grid.set(
      id,
      days.map((d) => {
        const e = entryAt.get(key(id, d));
        return {
          date: d,
          status: updateStatus("day", d, today, e as { submission?: string | null; plan?: string | null; progress?: string | null } | undefined, since),
          submitted_at: e?.submission === "manual" ? (e.submitted_at ?? null) : null,
          reminded: remindedAt.get(key(id, d)) ?? 0,
        };
      })
    );
  }
  return grid;
}

/** Of the working days in the grid that are over, the share submitted by the person (0–100). */
export function submissionRate(cells: StatusCell[]): number | null {
  const due = cells.filter((c) => c.status === "submitted" || c.status === "auto" || c.status === "missing");
  if (!due.length) return null;
  return Math.round((due.filter((c) => c.status === "submitted").length / due.length) * 100);
}
