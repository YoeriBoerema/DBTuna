import { test } from "node:test";
import assert from "node:assert/strict";
import { profileSchema } from "../../src/extension/connection/profile";
import { clientConfig } from "../../src/extension/connection/postgresClient";
test("profile serialization excludes secrets and validates port/TLS", () => {
  const p = profileSchema.parse({
    id: "test",
    type: "postgresql",
    name: "Local",
    host: "localhost",
    port: 5432,
    database: "test",
    user: "reader",
    ssl: "verify",
  });
  assert.deepEqual(profileSchema.parse(JSON.parse(JSON.stringify(p))), p);
  assert.throws(() => profileSchema.parse({ ...p, password: "secret" }));
  assert.throws(() => profileSchema.parse({ ...p, port: 0 }));
  assert.deepEqual(clientConfig(p, "secret").ssl, { rejectUnauthorized: true });
  assert.equal(clientConfig({ ...p, ssl: "disable" }, undefined).ssl, false);
});
