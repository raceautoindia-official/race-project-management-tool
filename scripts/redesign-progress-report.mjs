// Before/after report for the 2026-10-17 redesign: each project's progress
// under the old rule (checklist units, ticks count at once) and the new rule
// (weighted roll-up of approved work: each task's approved subtasks count by
// weight, and each task counts toward its project by its weight; Done = 100%).
//   node scripts/redesign-progress-report.mjs <database>
// Read-only. Uses MYSQL_* from .env.local.
import fs from "node:fs";
import mysql from "mysql2/promise";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);
const db = process.argv[2] ?? "pm_app_dev";
const c = await mysql.createConnection({
  host: env.MYSQL_HOST, port: +(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, database: db,
});
const [projects] = await c.query("SELECT id, name, status, approval_status, start_date, due_date FROM projects ORDER BY id");
const [tasks] = await c.query("SELECT id, project_id, status, weight, weight_mode FROM tasks");
const [subs] = await c.query("SELECT task_id, is_done, status, assignee_id, weight, weight_mode FROM subtasks");

// The same arithmetic as lib/work-engine.ts effectiveWeights(): manual
// weights as set, auto ones share what is left, cancelled ones get nothing.
function effective(items, cancelled = () => false) {
  const live = items.filter((x) => !cancelled(x));
  const manual = live.filter((x) => x.weight_mode === "manual").reduce((n, x) => n + Number(x.weight), 0);
  const autos = live.filter((x) => x.weight_mode !== "manual").length;
  const share = autos ? Math.max(0, 100 - manual) / autos : 0;
  return items.map((x) => (cancelled(x) ? 0 : x.weight_mode === "manual" ? Number(x.weight) : share));
}
/** A task's approved fraction, 0–1: Done is 1, else its approved subtasks by weight. */
function taskApproved(t) {
  if (t.status === "done") return 1;
  const items = subs.filter((x) => x.task_id === t.id);
  const w = effective(items, (x) => x.status === "cancelled");
  const total = w.reduce((n, x) => n + x, 0);
  if (!total) return 0;
  return items.reduce((n, x, i) => n + (x.status === "done" ? w[i] : 0), 0) / total;
}

const pct = (n) => `${Math.round(n)}%`.padStart(5);
console.log(`Database: ${db}\n`);
console.log("Project".padEnd(42), "Old".padStart(5), "New".padStart(5), " Tasks done/total  Notes");
for (const p of projects) {
  const ts = tasks.filter((t) => t.project_id === p.id);
  // Old: units = max(items, 1); credited = all if done else ticked items.
  let units = 0, credited = 0;
  for (const t of ts) {
    const items = subs.filter((s) => s.task_id === t.id);
    const u = Math.max(items.length, 1);
    units += u;
    credited += t.status === "done" ? u : items.filter((s) => s.is_done).length;
  }
  const oldPct = units ? (credited / units) * 100 : 0;
  // New: each task's approved share, by the task's weight.
  const done = ts.filter((t) => t.status === "done").length;
  const tw = effective(ts);
  const twTotal = tw.reduce((n, x) => n + x, 0);
  const newPct = twTotal ? (ts.reduce((n, t, i) => n + tw[i] * taskApproved(t), 0) / twTotal) * 100 : 0;
  const note = [];
  if (Math.abs(oldPct - newPct) >= 10) note.push(`${newPct < oldPct ? "drops" : "rises"}: each task now counts by its weight, not by how many items it has`);
  if (!p.due_date) note.push("no due date yet");
  console.log(p.name.slice(0, 41).padEnd(42), pct(oldPct), pct(newPct), `  ${String(done).padStart(4)}/${String(ts.length).padEnd(4)}       ${note.join("; ")}`);
}
const [[a]] = await c.query("SELECT COUNT(*) n, SUM(assignee_id IS NULL) unassigned, SUM(status='done') done, SUM(is_done) ticked FROM subtasks");
const [[d]] = await c.query("SELECT COUNT(*) n, SUM(level IS NULL) unset FROM designation_levels");
console.log(`\nSubtasks: ${a.n} total, ${a.done} approved (was ${a.ticked} ticked), ${a.unassigned} without an assignee (their task has none).`);
console.log(`Designation levels: ${d.n} job titles found, ${Number(d.unset ?? 0)} waiting for a level in Admin.`);
await c.end();
