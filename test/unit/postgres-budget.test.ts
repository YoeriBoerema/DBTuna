import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { createSecureContext, TLSSocket } from "node:tls";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { PostgresResponseBudget } from "../../src/extension/connection/postgresBudget";
import { collectPlan } from "../../src/extension/connection/postgresClient";

const frame = (type: string, payload = Buffer.alloc(0)) => {
  const result = Buffer.alloc(5 + payload.length);
  result[0] = type.charCodeAt(0);
  result.writeUInt32BE(payload.length + 4, 1);
  payload.copy(result, 5);
  return result;
};

test("protocol guard rejects declared oversize before any field body arrives", async () => {
  const guard = new PostgresResponseBudget(100);
  let forwarded = 0;
  guard.on("data", (chunk) => {
    forwarded += chunk.length;
  });
  const done = assert.rejects(finished(guard), /plan budget/);
  const header = frame("D");
  header.writeUInt32BE(1024 * 1024 * 1024, 1);
  guard.write(header.subarray(0, 2));
  guard.end(header.subarray(2));
  await done;
  assert.equal(forwarded, 2); // Only a partial header, never a large field.
});

test("protocol guard enforces cumulative bytes across split and coalesced frames", async () => {
  const valid = new PostgresResponseBudget(100);
  let received = 0;
  valid.on("data", (chunk) => {
    received += chunk.length;
  });
  const packet = frame("D", Buffer.alloc(50));
  const done = finished(valid);
  for (const byte of packet) valid.write(Buffer.from([byte]));
  valid.end();
  await done;
  assert.equal(received, packet.length);
  const overflowing = new PostgresResponseBudget(100);
  overflowing.resume();
  const rejected = assert.rejects(finished(overflowing), /plan budget/);
  overflowing.end(Buffer.concat([packet, packet]));
  await rejected;
  const invalid = new PostgresResponseBudget(100);
  invalid.resume();
  const malformed = frame("D");
  malformed.writeUInt32BE(3, 1);
  const invalidDone = assert.rejects(finished(invalid), /invalid/);
  invalid.end(malformed);
  await invalidDone;
});

// Actual pg driver, localhost fake protocol peer, no real DB or credentials.
// An enormous declared field is represented by five bytes, not a huge payload.
for (const tls of [false, true]) {
  test(`real pg parser rejects oversized frame over ${tls ? "verified TLS" : "plaintext"}`, async (t) => {
    let directory: string | undefined;
    let cert: Buffer | undefined, key: Buffer | undefined;
    if (tls) {
      directory = mkdtempSync(join(tmpdir(), "dbtuna-test-tls-"));
      try {
        execFileSync(
          "openssl",
          [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=localhost",
            "-addext",
            "subjectAltName=IP:127.0.0.1",
            "-keyout",
            join(directory, "key.pem"),
            "-out",
            join(directory, "cert.pem"),
          ],
          { stdio: "pipe", windowsHide: true },
        );
        cert = readFileSync(join(directory, "cert.pem"));
        key = readFileSync(join(directory, "key.pem"));
      } catch {
        rmSync(directory, { recursive: true, force: true });
        t.skip("OpenSSL is required to create an ephemeral test certificate.");
        return;
      }
    }
    let sent = 0;
    const sockets = new Set<Socket>();
    const serve = (socket: Socket) => {
      let authenticated = false;
      socket.on("error", () => {});
      socket.on("data", () => {
        if (!authenticated) {
          authenticated = true;
          const hello = Buffer.concat([
            frame("R", Buffer.alloc(4)),
            frame("Z", Buffer.from("I")),
          ]);
          sent += hello.length;
          socket.write(hello);
        } else {
          const header = frame("D");
          header.writeUInt32BE(1024 * 1024 * 1024, 1);
          sent += header.length;
          socket.write(header);
        }
      });
    };
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => {});
      if (!tls) serve(socket);
      else
        socket.once("data", () => {
          socket.write("S");
          const secure = new TLSSocket(socket, {
            isServer: true,
            secureContext: createSecureContext({ cert, key }),
          });
          serve(secure);
        });
    });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      await assert.rejects(
        collectPlan(
          {
            host: "127.0.0.1",
            port: address.port,
            database: "offline",
            user: "test",
            password: "test-only",
            ssl: tls ? { ca: cert, rejectUnauthorized: true } : false,
          },
          "SELECT 1",
        ),
        /plan budget/,
      );
      assert.ok(sent < 100, `only protocol headers were sent: ${sent}`);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  });
}
