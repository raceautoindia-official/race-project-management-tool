import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import { createDB } from "mysql-memory-server";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { E2E_PIN, USERS } from "./users";

/**
 * 1. Boots a throwaway MySQL 8.0 (mysql-memory-server) — never your dev DB.
 * 2. Loads db/schema.sql, then every migration (they must be re-runnable).
 * 3. Creates an `attendance` DB with the e2e employees (PIN 4321).
 * 4. Runs the real user sync (`scripts/seed.mjs`) against it.
 * 5. Starts the production build (`next start`) wired only to that database,
 *    with email and push disabled. Everything is torn down afterwards.
 */
export default async function globalSetup(config: FullConfig) {
  const root = path.dirname(config.configFile ?? path.resolve("playwright.config.ts"));
  const baseURL = String(config.projects[0].use.baseURL);
  const port = new URL(baseURL).port;

  if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
    throw new Error("No production build found. Run `npm run test:e2e` (it builds first).");
  }
  if (await isUp(baseURL)) {
    throw new Error(`Port ${port} is already in use. Stop that server or set E2E_PORT.`);
  }

  const db = await createDB({ version: "8.0.x", dbName: "pm_app", logLevel: "ERROR" });
  const conn = await mysql.createConnection({
    host: "127.0.0.1",
    port: db.port,
    user: db.username,
    password: "",
    multipleStatements: true,
  });
  await conn.query(readFileSync(path.join(root, "db/schema.sql"), "utf8"));
  const migrations = path.join(root, "db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    await conn.query(`USE pm_app; ${readFileSync(path.join(migrations, file), "utf8")}`);
  }

  const pinHash = await bcrypt.hash(E2E_PIN, 10);
  await conn.query(`
    CREATE DATABASE attendance;
    CREATE TABLE attendance.employees (
      id INT PRIMARY KEY, emp_id VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL,
      email VARCHAR(190) NULL, pin_hash VARCHAR(255) NOT NULL,
      role ENUM('employee','manager','super_admin') NOT NULL DEFAULT 'employee',
      is_active TINYINT(1) NOT NULL DEFAULT 1
    );`);
  for (const u of Object.values(USERS)) {
    await conn.query(
      `INSERT INTO attendance.employees (id, emp_id, name, email, pin_hash, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [u.id, u.empId, u.name, u.email, pinHash, u.role, u.active ? 1 : 0]
    );
  }
  await conn.end();

  // Explicit values win over .env.local, so the app can't reach any other DB,
  // send email or push notifications.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    MYSQL_HOST: "127.0.0.1",
    MYSQL_PORT: String(db.port),
    MYSQL_USER: db.username,
    MYSQL_PASSWORD: "",
    MYSQL_DATABASE: "pm_app",
    ATTENDANCE_DB_HOST: "127.0.0.1",
    ATTENDANCE_DB_PORT: String(db.port),
    ATTENDANCE_DB_USER: db.username,
    ATTENDANCE_DB_PASSWORD: "",
    ATTENDANCE_DB_NAME: "attendance",
    AUTH_SECRET: "e2e-only-secret-not-for-production-0123456789",
    SESSION_COOKIE_NAME: "pm_session",
    APP_BASE_URL: baseURL,
    MEETINGS_APP_URL: "https://meetings.example.test",
    SES_REGION: "",
    SES_ACCESS_KEY_ID: "",
    SES_SECRET_ACCESS_KEY: "",
    SES_FROM_EMAIL: "",
    AWS_REGION: "",
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
  };

  const seed = spawnSync(process.execPath, [path.join(root, "scripts/seed.mjs")], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  if (seed.status !== 0) {
    await db.stop();
    throw new Error(`User sync (scripts/seed.mjs) failed:\n${seed.stdout}\n${seed.stderr}`);
  }

  // Lee already leads an approved project, so members may nominate Lee to approve.
  const seeded = await mysql.createConnection({
    host: "127.0.0.1",
    port: db.port,
    user: db.username,
    password: "",
    database: "pm_app",
  });
  const [[leadRow]] = await seeded.query<mysql.RowDataPacket[]>(
    "SELECT id FROM users WHERE emp_id = ?",
    [USERS.lead.empId]
  );
  const [project] = await seeded.query<mysql.ResultSetHeader>(
    "INSERT INTO projects (name, status, approval_status, owner_id) VALUES ('E2E Operations', 'active', 'approved', ?)",
    [leadRow.id]
  );
  await seeded.query(
    "INSERT INTO project_members (project_id, user_id, role_in_project) VALUES (?, ?, 'lead')",
    [project.insertId, leadRow.id]
  );
  await seeded.end();

  const logDir = path.join(root, "test-results");
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(path.join(logDir, "e2e-server.log"));
  const server = spawn(
    process.execPath,
    [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", port],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" }
  );
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);

  // Specs reach the throwaway database through this (workers inherit env).
  process.env.E2E_DB_PORT = String(db.port);

  const teardown = async () => {
    killTree(server);
    await db.stop();
  };

  try {
    await waitUntilUp(baseURL, server);
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}

async function isUp(baseURL: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/login", baseURL), { redirect: "manual" });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitUntilUp(baseURL: string, server: ChildProcess) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`next start exited early (code ${server.exitCode}); see test-results/e2e-server.log`);
    }
    if (await isUp(baseURL)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("next start did not come up within 90s; see test-results/e2e-server.log");
}

function killTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}
