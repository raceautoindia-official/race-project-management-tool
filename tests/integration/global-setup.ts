import type { TestProject } from "vitest/node";
import { createDB } from "mysql-memory-server";
import { createSchemaDatabase, type MysqlConfig } from "./db";

/**
 * Boots a throwaway MySQL 8.0 (reusing a local install when present) and loads
 * db/schema.sql into `pm_test`. Set TEST_MYSQL_HOST/PORT/USER/PASSWORD to run
 * against an existing server instead — the `pm_test` database is recreated.
 */
export default async function setup(project: TestProject) {
  let stop = async () => {};
  let config: MysqlConfig;

  if (process.env.TEST_MYSQL_HOST) {
    config = {
      host: process.env.TEST_MYSQL_HOST,
      port: Number(process.env.TEST_MYSQL_PORT ?? 3306),
      user: process.env.TEST_MYSQL_USER ?? "root",
      password: process.env.TEST_MYSQL_PASSWORD ?? "",
      database: "pm_test",
    };
  } else {
    const db = await createDB({ version: "8.0.x", dbName: "pm_test", logLevel: "ERROR" });
    config = {
      host: "127.0.0.1",
      port: db.port,
      user: db.username,
      password: "",
      database: "pm_test",
    };
    stop = () => db.stop();
  }

  await createSchemaDatabase(config, config.database);
  project.provide("mysql", config);
  return stop;
}
