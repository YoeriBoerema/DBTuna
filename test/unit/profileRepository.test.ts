import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ProfileRepository,
  type SettingsStore,
  type SecretStore,
} from "../../src/extension/connection/profileRepository";
import {
  profileSchema,
  sameConnection,
} from "../../src/extension/connection/profile";
function storage() {
  const values = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const settings: SettingsStore = {
    get: <T>(key: string, fallback: T) =>
      (values.has(key) ? values.get(key) : fallback) as T,
    update: async (key, value) => {
      values.set(key, value);
    },
  };
  const secretStore: SecretStore = {
    get: async (key) => secrets.get(key),
    store: async (key, value) => {
      secrets.set(key, value);
    },
    delete: async (key) => {
      secrets.delete(key);
    },
  };
  return {
    values,
    secrets,
    repository: new ProfileRepository(settings, secretStore),
  };
}
const profile = profileSchema.parse({
  id: "pg",
  name: "Test",
  type: "postgresql",
  host: "localhost",
  port: 55439,
  database: "test",
  user: "test",
  ssl: "disable",
});
test("profile repository keeps passwords separate and removes only the selected profile's data", async () => {
  const { repository, values, secrets } = storage();
  await repository.initialize();
  await repository.save(profile, "test-only-secret");
  assert.equal(repository.active()?.id, profile.id);
  assert.equal(await repository.password(profile), "test-only-secret");
  assert.equal(
    JSON.stringify([...values.values()]).includes("test-only-secret"),
    false,
  );
  secrets.set("unrelated-extension", "keep");
  await repository.remove(profile);
  assert.equal(repository.active(), undefined);
  assert.deepEqual(repository.profiles(), []);
  assert.deepEqual([...secrets.keys()], ["unrelated-extension"]);
});
test("legacy connection migration runs once and preserves typed profiles on subsequent starts", async () => {
  const { repository, values, secrets } = storage();
  values.set("connections", [{ id: "legacy" }]);
  secrets.set("dbtuna.password.legacy", "old");
  secrets.set("other", "keep");
  await repository.initialize();
  assert.equal(secrets.has("dbtuna.password.legacy"), false);
  assert.equal(secrets.get("other"), "keep");
  await repository.save(profile, "new");
  await repository.initialize();
  assert.equal(repository.active()?.id, profile.id);
  assert.equal(await repository.password(profile), "new");
});
test("connection identity ignores property order and detects changes; profile variants reject irrelevant fields", () => {
  const reordered = Object.fromEntries(Object.entries(profile).reverse());
  assert.equal(sameConnection(profile, profileSchema.parse(reordered)), true);
  assert.equal(sameConnection(profile, { ...profile, port: 55440 }), false);
  assert.equal(
    profileSchema.safeParse({
      ...profile,
      authentication: "ntlm",
      domain: "domain",
    }).success,
    false,
  );
  assert.equal(
    profileSchema.safeParse({ ...profile, ssl: "trust" }).success,
    false,
  );
});

test("invalid profiles fail before changing storage or secrets", async () => {
  const { repository, values, secrets } = storage();
  await repository.initialize();
  await repository.save(profile, "original");
  const before = JSON.stringify([...values]);
  await assert.rejects(() =>
    repository.save({ ...profile, port: -1 }, "replacement"),
  );
  assert.equal(JSON.stringify([...values]), before);
  assert.equal(secrets.get("dbtuna.password.pg"), "original");
});
