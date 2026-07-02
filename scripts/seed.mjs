// User-sync script. Run with: npm run seed
//
// Identity lives in the parent Attendance app. This script mirrors every
// employee from `attendance.employees` into `pm_app.users` so they can be
// assigned to projects/tasks even before their first login. It is idempotent
// (keyed on employee_id) and safe to re-run whenever employees change.
//
// Role mapping:  super_admin, manager -> admin;  employee -> member.

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

function mapRole(role) {
  return role === "super_admin" || role === "manager" ? "admin" : "member";
}

async function main() {
  const pmPool = mysql.createPool({
    host: process.env.MYSQL_HOST ?? "localhost",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "pm_app",
    waitForConnections: true,
    connectionLimit: 5,
  });

  const attPool = mysql.createPool({
    host: process.env.ATTENDANCE_DB_HOST ?? process.env.MYSQL_HOST ?? "localhost",
    port: Number(
      process.env.ATTENDANCE_DB_PORT ?? process.env.MYSQL_PORT ?? 3306
    ),
    user: process.env.ATTENDANCE_DB_USER ?? process.env.MYSQL_USER ?? "root",
    password:
      process.env.ATTENDANCE_DB_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "",
    database: process.env.ATTENDANCE_DB_NAME ?? "attendance",
    waitForConnections: true,
    connectionLimit: 5,
  });

  const attName = process.env.ATTENDANCE_DB_NAME ?? "attendance";
  console.log(`Syncing users from "${attName}.employees" -> pm_app.users…`);

  const [employees] = await attPool.execute(
    `SELECT id, emp_id, name, email, role, is_active FROM employees`
  );

  let synced = 0;
  for (const e of employees) {
    await pmPool.execute(
      `INSERT INTO users (employee_id, emp_id, name, email, role, is_active)
         VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         emp_id    = VALUES(emp_id),
         name      = VALUES(name),
         email     = VALUES(email),
         role      = VALUES(role),
         is_active = VALUES(is_active)`,
      [e.id, e.emp_id, e.name, e.email, mapRole(e.role), e.is_active ? 1 : 0]
    );
    synced++;
    console.log(
      `  ✓ ${e.emp_id.padEnd(10)} ${e.name.padEnd(20)} -> ${mapRole(e.role)}`
    );
  }

  await pmPool.end();
  await attPool.end();
  console.log(`\nDone. Synced ${synced} user(s).`);
  console.log("Login with an Employee ID + PIN from the attendance app.");
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
