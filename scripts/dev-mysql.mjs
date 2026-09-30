// Local development MySQL, separate from any installed MySQL service.
// Run with: npm run db:dev   (keep it running while you use `npm run dev`)
//
// Data lives in .mysql-dev/ (git-ignored). The first run initializes it with a
// passwordless root user, reachable only on 127.0.0.1:3307. Point .env.local at
// it with MYSQL_HOST=127.0.0.1, MYSQL_PORT=3307, MYSQL_USER=root, MYSQL_PASSWORD=
//
// MYSQLD overrides the mysqld binary path; DEV_MYSQL_PORT the port.

import { existsSync, mkdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const mysqld =
  process.env.MYSQLD ?? "C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqld.exe";
const port = process.env.DEV_MYSQL_PORT ?? "3307";
const root = path.resolve(".mysql-dev");
const datadir = path.join(root, "data");

if (!existsSync(mysqld)) {
  console.error(`mysqld not found at "${mysqld}". Set MYSQLD to its path.`);
  process.exit(1);
}

if (!existsSync(datadir)) {
  mkdirSync(root, { recursive: true });
  console.log(`Initializing a new dev database in ${datadir} …`);
  const init = spawnSync(
    mysqld,
    ["--no-defaults", `--datadir=${datadir}`, "--initialize-insecure", "--console"],
    { stdio: "inherit" }
  );
  if (init.status !== 0) process.exit(init.status ?? 1);
}

console.log(`Starting dev MySQL on 127.0.0.1:${port} (Ctrl+C to stop) …`);
const server = spawn(
  mysqld,
  [
    "--no-defaults",
    `--datadir=${datadir}`,
    `--port=${port}`,
    "--bind-address=127.0.0.1",
    "--mysqlx=OFF",
    "--console",
  ],
  { stdio: "inherit" }
);
server.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.kill());
}
