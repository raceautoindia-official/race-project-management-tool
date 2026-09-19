import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    mysql: MysqlConfig;
  }
}

const SCHEMA = new URL("../../db/schema.sql", import.meta.url);

/** A multi-statement connection to the server (no default database). */
export function serverConnection(c: MysqlConfig) {
  return mysql.createConnection({
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    multipleStatements: true,
    dateStrings: true,
  });
}

/** Create `database` from db/schema.sql (dropping any previous copy). */
export async function createSchemaDatabase(c: MysqlConfig, database: string) {
  const sql = readFileSync(SCHEMA, "utf8").replace(/\bpm_app\b/g, database);
  const conn = await serverConnection(c);
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await conn.query(sql);
  } finally {
    await conn.end();
  }
}
