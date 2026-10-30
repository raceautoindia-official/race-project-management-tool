/**
 * Who the staff sweep (lib/staff-sync.ts) would retire or bring back, by
 * name — without changing anything. Run it on the server before the
 * work-updates cron is switched on, and compare the list with who has
 * actually left:
 *
 *   node scripts/staff-sync-preview.mjs
 *
 * Read-only on both databases. If the list is right, either let the cron do
 * it or press "Check against Attendance now" on Team › Retired. If it would
 * retire more than half the current staff, the sweep holds until an admin
 * confirms on that page.
 */
import { readFileSync, existsSync } from "node:fs";
import mysql from "mysql2/promise";

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
}

loadEnv(".env.local");
loadEnv(".env");

const pm = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "localhost",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
  database: process.env.MYSQL_DATABASE ?? "pm_app",
});

const attendance = await mysql.createConnection({
  host: process.env.ATTENDANCE_DB_HOST ?? process.env.MYSQL_HOST ?? "localhost",
  port: Number(process.env.ATTENDANCE_DB_PORT ?? process.env.MYSQL_PORT ?? 3306),
  user: process.env.ATTENDANCE_DB_USER ?? process.env.MYSQL_USER ?? "root",
  password: process.env.ATTENDANCE_DB_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "",
  database: process.env.ATTENDANCE_DB_NAME ?? "attendance",
});

try {
  const [people] = await pm.query(`SELECT id, employee_id, emp_id, name, is_active FROM users ORDER BY name`);
  const [roster] = await attendance.query(`SELECT id, is_active FROM employees`);
  const byId = new Map(roster.map((e) => [Number(e.id), e]));

  const retire = [];
  const back = [];
  for (const p of people) {
    const emp = byId.get(Number(p.employee_id));
    const working = Boolean(emp?.is_active);
    if (p.is_active && !working) retire.push({ ...p, why: emp ? "switched off in Attendance" : "not in Attendance" });
    else if (!p.is_active && working) back.push(p);
  }
  const active = people.filter((p) => p.is_active).length;

  console.log(`PM: ${people.length} people, ${active} active. Attendance: ${roster.length} employees, ${roster.filter((e) => e.is_active).length} active.\n`);
  console.log(`Would retire ${retire.length}:`);
  for (const p of retire) console.log(`  ${p.emp_id.padEnd(12)} ${p.name}  (${p.why})`);
  console.log(`\nWould bring back ${back.length}:`);
  for (const p of back) console.log(`  ${p.emp_id.padEnd(12)} ${p.name}`);
  if (!roster.length) {
    console.log("\nAttendance returned nobody: the sweep would change nothing.");
  } else if (retire.length > 5 && retire.length > active / 2) {
    console.log("\nMore than half the current staff: the sweep will hold until an admin confirms on Team › Retired.");
  }
  console.log("\nNothing was changed.");
} finally {
  await pm.end();
  await attendance.end();
}
