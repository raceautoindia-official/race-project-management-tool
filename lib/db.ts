import mysql from "mysql2/promise";

// A single shared connection pool, reused across requests / hot reloads.
// In dev, Next.js clears the module cache between edits, so we stash the
// pool on globalThis to avoid exhausting MySQL connections.
declare global {
  var __pmPool: mysql.Pool | undefined;
}

function createPool(): mysql.Pool {
  return mysql.createPool({
    host: process.env.MYSQL_HOST ?? "localhost",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "pm_app",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    namedPlaceholders: false,
    dateStrings: true,
  });
}

export const pool: mysql.Pool = global.__pmPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  global.__pmPool = pool;
}

/**
 * Run a parameterized query and return typed rows.
 * Always pass user input through the `params` array — never concatenate.
 */
type SqlParam = string | number | boolean | Date | null;

export async function query<T = mysql.RowDataPacket[]>(
  sql: string,
  params: unknown[] = []
): Promise<T> {
  const [rows] = await pool.execute(sql, params as SqlParam[]);
  return rows as T;
}

export type DbRow = mysql.RowDataPacket;
export type DbResult = mysql.ResultSetHeader;
