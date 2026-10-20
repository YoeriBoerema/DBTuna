import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
const require = createRequire(import.meta.url);
const embeddedRequire = createRequire(require.resolve("embedded-postgres"));
const platform = process.platform === "win32" ? "windows" : process.platform;
const binaries = await import(
  pathToFileURL(
    embeddedRequire.resolve(`@embedded-postgres/${platform}-${process.arch}`),
  ).href
);
mkdirSync("work", { recursive: true });
const base = mkdtempSync(resolve("work/pg-"));
const data = join(base, "data");
const password = join(base, "password");
const port = process.env.DBTUNA_TEST_PORT || "55439";
const run = (exe, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`${exe} exited ${code}`)),
    );
  });
writeFileSync(password, "test-only\n", { mode: 0o600 });
let started = false;
try {
  await run(binaries.initdb, [
    "-D",
    data,
    "-U",
    "dbtuna",
    "--auth=scram-sha-256",
    "--pwfile=" + password,
    "--no-locale",
  ]);
  unlinkSync(password);
  await run(binaries.pg_ctl, [
    "-D",
    data,
    "-l",
    join(base, "server.log"),
    "-o",
    `-h 127.0.0.1 -p ${port}`,
    "-w",
    "start",
  ]);
  started = true;
  await run(process.execPath, [
    "--import",
    "tsx",
    "--test",
    "test/integration/postgres.test.ts",
  ]);
} finally {
  if (started)
    await run(binaries.pg_ctl, ["-D", data, "-m", "fast", "-w", "stop"]);
}
