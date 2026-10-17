// Local sandbox for trying the app in a browser without real people's logins.
//
//   node scripts/dev-sandbox.mjs
//
// - Creates `attendance_dev.employees` with the e2e test employees (e2e/users.ts,
//   PIN 4321 — test values only), so login works against test accounts.
// - Mirrors them into `pm_app_dev.users` and gives them a "Redesign sandbox"
//   project with a task split into subtasks, so every role has something to do.
// - Writes nothing to pm_app or the real attendance DB. Refuses if .env.local
//   points MYSQL_DATABASE at pm_app_dev (it should be the real one; the dev
//   overrides live in .env.development.local, which this script also writes).
import fs from "node:fs";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);
const PM = "pm_app_dev";
const ATT = "attendance_dev";
const PIN = "4321"; // the e2e test PIN (e2e/users.ts)

const PEOPLE = [
  { id: 9001, emp: "E2EADMIN", name: "Asha Admin", dept: "Design", title: "Head of Design", role: "super_admin" },
  { id: 9002, emp: "E2ELEAD", name: "Lee Lead", dept: "Design", title: "Senior Engineer", role: "employee" },
  { id: 9003, emp: "E2EALICE", name: "Alice Requester", dept: "Production", title: "Production Engineer", role: "employee" },
  { id: 9004, emp: "E2ESAM", name: "Sam Owner", dept: "Design", title: "Design Engineer", role: "employee" },
  { id: 9005, emp: "E2EOLIVIA", name: "Olivia Outsider", dept: "Quality", title: "Quality Inspector", role: "employee" },
];

const c = await mysql.createConnection({
  host: env.MYSQL_HOST, port: +(env.MYSQL_PORT || 3306),
  user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, multipleStatements: true,
});
const [[has]] = await c.query("SELECT COUNT(*) n FROM information_schema.schemata WHERE schema_name = ?", [PM]);
if (!has.n) { console.error(`${PM} does not exist — restore a copy first.`); process.exit(1); }

const pinHash = await bcrypt.hash(PIN, 10);
await c.query(`CREATE DATABASE IF NOT EXISTS ${ATT};
  CREATE TABLE IF NOT EXISTS ${ATT}.employees (
    id INT PRIMARY KEY, emp_id VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL,
    email VARCHAR(190) NULL, department VARCHAR(100) NULL, designation VARCHAR(120) NULL,
    pin_hash VARCHAR(255) NOT NULL,
    role ENUM('employee','manager','super_admin') NOT NULL DEFAULT 'employee',
    is_active TINYINT(1) NOT NULL DEFAULT 1, manager_id INT NULL
  );`);
const ids = {};
for (const p of PEOPLE) {
  await c.query(
    `REPLACE INTO ${ATT}.employees (id, emp_id, name, email, department, designation, pin_hash, role, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [p.id, p.emp, p.name, `${p.emp.toLowerCase()}@sandbox.test`, p.dept, p.title, pinHash, p.role]
  );
  await c.query(
    `INSERT INTO ${PM}.users (employee_id, emp_id, name, email, department, designation, role, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE name = VALUES(name), department = VALUES(department), designation = VALUES(designation)`,
    [p.id, p.emp, p.name, `${p.emp.toLowerCase()}@sandbox.test`, p.dept, p.title, p.role === "super_admin" ? "admin" : "member"]
  );
  const [[u]] = await c.query(`SELECT id FROM ${PM}.users WHERE employee_id = ?`, [p.id]);
  ids[p.emp] = u.id;
  await c.query(`INSERT IGNORE INTO ${PM}.designation_levels (title) VALUES (?)`, [p.title]);
}

const [[existing]] = await c.query(`SELECT id FROM ${PM}.projects WHERE name = 'Redesign sandbox' LIMIT 1`);
if (!existing) {
  const [p] = await c.query(
    `INSERT INTO ${PM}.projects (name, description, department, status, approval_status, owner_id, start_date, due_date)
     VALUES ('Redesign sandbox', 'Test project for trying the redesign locally.', 'Design', 'active', 'approved', ?, CURRENT_DATE() - INTERVAL 10 DAY, CURRENT_DATE() + INTERVAL 30 DAY)`,
    [ids.E2ELEAD]
  );
  const pid = p.insertId;
  for (const [emp, role] of [["E2ELEAD", "lead"], ["E2ESAM", "member"], ["E2EALICE", "member"]]) {
    await c.query(`INSERT IGNORE INTO ${PM}.project_members (project_id, user_id, role_in_project) VALUES (?, ?, ?)`, [pid, ids[emp], role]);
  }
  const [t] = await c.query(
    `INSERT INTO ${PM}.tasks (project_id, title, status, assignee_id, created_by, requested_by, request_approved_by, request_approved_at, start_date, due_date)
     VALUES (?, 'Design the dashboard', 'in_progress', ?, ?, ?, ?, UTC_TIMESTAMP(), CURRENT_DATE() - INTERVAL 5 DAY, CURRENT_DATE() + INTERVAL 10 DAY)`,
    [pid, ids.E2ESAM, ids.E2ELEAD, ids.E2EALICE, ids.E2ELEAD]
  );
  const subs = [["Wireframes", "E2ESAM", "done"], ["Colour palette", "E2EALICE", "review"], ["Final mock-ups", "E2EALICE", "todo"]];
  for (const [i, [title, emp, status]] of subs.entries()) {
    await c.query(
      `INSERT INTO ${PM}.subtasks (task_id, title, assignee_id, status, is_done, position, submitted_at, approved_by, approved_at, due_date)
       VALUES (?, ?, ?, ?, ?, ?, IF(? IN ('review','done'), UTC_TIMESTAMP(), NULL), IF(? = 'done', ?, NULL), IF(? = 'done', UTC_TIMESTAMP(), NULL), CURRENT_DATE() + INTERVAL ? DAY)`,
      [t.insertId, title, ids[emp], status, status === "done" ? 1 : 0, i, status, status, ids.E2ESAM, status, 2 + i * 3]
    );
  }
  await c.query(
    `INSERT INTO ${PM}.tasks (project_id, title, status, assignee_id, created_by, requested_by, request_approved_by, request_approved_at, start_date, due_date)
     VALUES (?, 'Write the launch note', 'todo', ?, ?, ?, ?, UTC_TIMESTAMP(), CURRENT_DATE(), CURRENT_DATE() + INTERVAL 20 DAY)`,
    [pid, ids.E2ELEAD, ids.E2ELEAD, ids.E2ELEAD, ids.E2ELEAD]
  );
  console.log(`Created "Redesign sandbox" (project ${pid}).`);
} else {
  console.log(`"Redesign sandbox" already exists (project ${existing.id}).`);
}
await c.end();

// Dev overrides: test databases, no real email / push / WhatsApp / video.
fs.writeFileSync(".env.development.local", [
  "# Written by scripts/dev-sandbox.mjs — local testing only (git-ignored).",
  `MYSQL_DATABASE=${PM}`,
  `ATTENDANCE_DB_NAME=${ATT}`,
  "APP_BASE_URL=http://localhost:3100",
  "SES_REGION=", "SES_ACCESS_KEY_ID=", "SES_SECRET_ACCESS_KEY=", "SES_FROM_EMAIL=",
  "SMTP_HOST=", "AWS_REGION=", "AWS_ACCESS_KEY_ID=", "AWS_SECRET_ACCESS_KEY=",
  "NEXT_PUBLIC_VAPID_PUBLIC_KEY=", "VAPID_PRIVATE_KEY=",
  "MEETINGS_APP_URL=https://meetings.example.test", "MEETINGS_API_KEY=",
  "WHATSAPP_TOKEN=", "",
].join("\n"));
console.log("Wrote .env.development.local. Start the app with: node scripts/dev-sandbox-server.mjs. Test logins: E2EADMIN, E2ELEAD, E2ESAM, E2EALICE, E2EOLIVIA (PIN in e2e/users.ts).");
