import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type oracledb from "oracledb";

test("bundled Oracle Thin driver loads and opens an isolated transport without native client libraries", async () => {
  const outfile = resolve("work/oracle-driver-smoke.cjs");
  await build({
    stdin: {
      contents: "module.exports = require('oracledb');",
      resolveDir: process.cwd(),
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
  });
  const driver = createRequire(import.meta.url)(outfile) as typeof oracledb;
  assert.equal(driver.thin, true);
  let accepted = false;
  const server = createServer((socket) => {
    accepted = true;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await assert.rejects(
      driver.getConnection({
        user: "isolated_test",
        password: "not-a-real-password",
        connectString: `127.0.0.1:${address.port}/TEST?connect_timeout=1&transport_connect_timeout=1&retry_count=0`,
      }),
    );
    assert.ok(accepted, "Bundled Thin driver failed before opening its socket");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
