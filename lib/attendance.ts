import "server-only";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { query, DbRow } from "./db";
import type { Role } from "./types";

/**
 * lib/attendance.ts — read-only access to the *parent* Attendance app database.
 *
 * The Attendance app (`attendance` DB) is the single source of truth for
 * identity and credentials. This PM tool does NOT store passwords; it
 * validates the employee's PIN against `attendance.employees` and then
 * mirrors the employee into its own `pm_app.users` table so all existing
 * foreign keys (projects, tasks, comments…) keep working.
 *
 * Both databases currently live on the same MySQL server, so this is a
 * second pool on the same host pointed at a different schema. If the two
 * apps are ever split across servers, only the ATTENDANCE_DB_* env vars
 * need to change.
 */

declare global {
  var __attendancePool: mysql.Pool | undefined;
}

function createAttendancePool(): mysql.Pool {
  return mysql.createPool({
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
    queueLimit: 0,
    enableKeepAlive: true,
    namedPlaceholders: false,
    dateStrings: true,
  });
}

export const attendancePool: mysql.Pool =
  global.__attendancePool ?? createAttendancePool();

if (process.env.NODE_ENV !== "production") {
  global.__attendancePool = attendancePool;
}

/** The attendance-side employee row we care about for auth + mirroring. */
export interface AttendanceEmployee {
  id: number;
  emp_id: string;
  name: string;
  email: string | null;
  pin_hash: string;
  role: "employee" | "manager" | "super_admin";
  is_active: number;
}

/**
 * Map an attendance role onto a PM role.
 *   super_admin, manager -> admin
 *   employee             -> member
 */
export function mapAttendanceRole(role: string): Role {
  return role === "super_admin" || role === "manager" ? "admin" : "member";
}

/** Look up an active-or-inactive employee by their emp_id (e.g. "RACE005"). */
export async function findEmployeeByEmpId(
  empId: string
): Promise<AttendanceEmployee | null> {
  const [rows] = await attendancePool.execute(
    `SELECT id, emp_id, name, email, pin_hash, role, is_active
       FROM employees
      WHERE emp_id = ?
      LIMIT 1`,
    [empId]
  );
  const list = rows as AttendanceEmployee[];
  return list[0] ?? null;
}

/**
 * Re-read an employee's active flag and role from Attendance and mirror any
 * change into pm_app.users, so a deactivation or demotion takes effect on an
 * existing session. An employee missing from Attendance counts as inactive.
 * Returns null (and changes nothing) if Attendance can't be reached, so an
 * Attendance outage doesn't lock everyone out.
 */
export async function syncEmployeeStatus(
  employeeId: number,
  current: { role: Role; is_active: boolean }
): Promise<{ role: Role; is_active: boolean } | null> {
  try {
    const [rows] = await attendancePool.execute(
      `SELECT role, is_active FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = (rows as Pick<AttendanceEmployee, "role" | "is_active">[])[0];
    const fresh = {
      role: emp ? mapAttendanceRole(emp.role) : current.role,
      is_active: Boolean(emp?.is_active),
    };
    if (fresh.role !== current.role || fresh.is_active !== current.is_active) {
      await query(`UPDATE users SET role = ?, is_active = ? WHERE employee_id = ?`, [
        fresh.role,
        fresh.is_active ? 1 : 0,
        employeeId,
      ]);
    }
    return fresh;
  } catch (err) {
    console.error("[attendance] status sync failed:", (err as Error).message);
    return null;
  }
}

/** Constant-time-ish PIN check (bcrypt). */
export async function verifyEmployeePin(
  pin: string,
  pinHash: string
): Promise<boolean> {
  return bcrypt.compare(pin, pinHash);
}

/** A dummy bcrypt hash so a missing employee still costs one bcrypt compare
 *  (avoids timing-based employee-ID enumeration). */
export const DUMMY_PIN_HASH =
  "$2b$12$GqF5VqQ1QGR0P5j0m1uNxuBBsMPJVQBQD4mV7fJLgTB8rXY3fXy8O";

/**
 * Mirror an attendance employee into the local `pm_app.users` table and
 * return the local PM user id. Idempotent — keyed on `employee_id`. This is
 * the "just-in-time provisioning" that runs on every successful login so PM
 * always reflects the parent's name / email / role / active status.
 */
export async function provisionPmUser(
  emp: AttendanceEmployee
): Promise<number> {
  const role = mapAttendanceRole(emp.role);
  await query(
    `INSERT INTO users (employee_id, emp_id, name, email, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       emp_id    = VALUES(emp_id),
       name      = VALUES(name),
       email     = VALUES(email),
       role      = VALUES(role),
       is_active = VALUES(is_active)`,
    [emp.id, emp.emp_id, emp.name, emp.email, role, emp.is_active ? 1 : 0]
  );
  const rows = await query<DbRow[]>(
    `SELECT id FROM users WHERE employee_id = ? LIMIT 1`,
    [emp.id]
  );
  return rows[0].id as number;
}
