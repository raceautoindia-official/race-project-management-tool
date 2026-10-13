/**
 * Copy every employee's department and designation from Attendance into
 * pm_app.users. Run with: npm run sync:departments
 *
 * PM mirrors identity from the Attendance app rather than keeping a second
 * list of its own, and a department arrives with the person: on login, and on
 * the once-a-minute heartbeat that already picks up role and deactivation
 * changes. That means departments fill in gradually as people use the app.
 *
 * This does the whole directory in one pass, so the filters are populated the
 * day the feature ships rather than a week later — and so somebody who is
 * assigned work but has not signed in yet still shows their department.
 *
 * It reads Attendance and writes only to pm_app.users.department. Attendance
 * is never written to.
 *
 *   node scripts/sync-departments.mjs --dry-run   # show what would change
 *   node scripts/sync-departments.mjs             # apply it
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

const dryRun = process.argv.includes("--dry-run");

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
  // Ask for the columns this Attendance actually has: an older one may
  // carry a department and no designation, and asking for both would then
  // get neither.
  const [cols] = await attendance.query(
    `SELECT column_name AS c FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'employees'`
  );
  const present = new Set(cols.map((r) => String(r.c).toLowerCase()));
  const fields = ["department", "designation"].filter((f) => present.has(f));
  if (fields.length === 0) {
    console.log(
      "Attendance has neither a department nor a designation column on employees — nothing to copy."
    );
    process.exit(0);
  }
  console.log(`Copying: ${fields.join(", ")}
`);

  const [employees] = await attendance.query(
    `SELECT id, ${fields.join(", ")} FROM employees`
  );
  const byEmployee = new Map(employees.map((e) => [Number(e.id), e]));

  const [users] = await pm.query(
    `SELECT id, employee_id, name, department, designation FROM users ORDER BY name`
  );

  let changed = 0;
  let unknown = 0;
  for (const u of users) {
    if (!byEmployee.has(Number(u.employee_id))) {
      unknown += 1;
      continue;
    }
    const emp = byEmployee.get(Number(u.employee_id));
    const sets = [];
    const values = [];
    for (const field of fields) {
      const next = emp[field] || null;
      const now = u[field] || null;
      if (next === now) continue;
      sets.push(`${field} = ?`);
      values.push(next);
      console.log(`${u.name} ${field}: ${now ?? "—"} → ${next ?? "—"}`);
    }
    if (!sets.length) continue;
    changed += 1;
    if (!dryRun) {
      await pm.execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [
        ...values,
        u.id,
      ]);
    }
  }

  console.log(
    `\n${users.length} user(s) checked, ${changed} ${
      dryRun ? "would change" : "updated"
    }${unknown ? `, ${unknown} not found in Attendance (left alone)` : ""}.`
  );

  const [counts] = await pm.query(
    `SELECT COALESCE(department, '(none)') AS department, COUNT(*) AS n
       FROM users WHERE is_active = 1
      GROUP BY department ORDER BY n DESC`
  );
  console.log("\nActive people by department:");
  for (const row of counts) console.log(`  ${row.n}\t${row.department}`);
} finally {
  await pm.end();
  await attendance.end();
}
