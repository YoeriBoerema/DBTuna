import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const load = () =>
  import(new URL("../helpers/deployedDatabases.mjs", import.meta.url).href);
function fixture(
  t: { after: (fn: () => void) => void },
  options: { failEngine?: string; failPrepare?: boolean } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "dbtuna-deployed-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "test-databases.json");
  const calls: string[][] = [],
    suites: { args: string[]; env: Record<string, string> }[] = [];
  const containers = new Map<
    string,
    {
      labels: Record<string, string>;
      image: string;
      running: boolean;
      bindings: Record<string, { HostIp: string; HostPort: string }[]>;
    }
  >();
  containers.set("mssql-adventureworks", {
    labels: {},
    image: "unrelated",
    running: true,
    bindings: {},
  });
  const command = (args: string[]) => {
    calls.push(args);
    if (args[0] === "create") {
      const labels: Record<string, string> = {};
      for (let i = 0; i < args.length; i++)
        if (args[i] === "--label") {
          const [key, value] = args[i + 1].split("=");
          labels[key] = value;
        }
      const [HostIp, HostPort, containerPort] =
        args[args.indexOf("--publish") + 1].split(":");
      containers.set(args[args.indexOf("--name") + 1], {
        labels,
        image: args.at(-1)!,
        running: false,
        bindings: { [`${containerPort}/tcp`]: [{ HostIp, HostPort }] },
      });
    }
    if (args[0] === "start") {
      const container = containers.get(args[1])!;
      if (container.labels["dbtuna.integration"] === options.failEngine)
        throw Error("simulated start failure");
      container.running = true;
    }
    if (args[0] === "container")
      return containers.has(args.at(-1)!.slice(7, -1)) ? "owned-id" : "";
    if (args[0] === "inspect") {
      const container = containers.get(args.at(-1)!);
      if (!container) throw Error("missing container");
      if (args[2].includes(".State"))
        return JSON.stringify({
          Running: container.running,
          Health: { Status: "healthy" },
        });
      if (args[2].includes(".PortBindings"))
        return JSON.stringify(container.bindings);
      if (args[2].includes(".Config.Image")) return container.image;
      return JSON.stringify(container.labels);
    }
    if (args[0] === "rm") containers.delete(args.at(-1)!);
    if (args[0] === "exec" && args.includes("sqlplus") && options.failPrepare)
      throw Error("simulated initialization failure");
    return "ok";
  };
  const run = (args: string[], env: Record<string, string>) =>
    suites.push({ args, env });
  return { path, calls, containers, suites, dependencies: { command, run } };
}
test("persistent deployment stays running, supplies integration credentials privately and cleans up only owned containers", async (t) => {
  const { manageDatabases } = await load(),
    f = fixture(t);
  const messages: string[] = [],
    log = console.log;
  console.log = (message: string) => messages.push(message);
  try {
    await manageDatabases("up", f.path, f.dependencies);
    const state = JSON.parse(readFileSync(f.path, "utf8"));
    assert.equal(state.entries.length, 3);
    assert.ok(state.entries.every((entry: { ready: boolean }) => entry.ready));
    assert.equal(f.containers.size, 4);
    assert.equal(f.calls.filter((args) => args[0] === "rm").length, 0);
    for (const entry of state.entries) {
      assert.ok(!messages.join("\n").includes(entry.password));
      assert.ok(!f.calls.flat().join(" ").includes(entry.password));
    }
    assert.ok(
      f.calls
        .filter((args) => args[0] === "create")
        .every((args) =>
          args[args.indexOf("--publish") + 1].startsWith("127.0.0.1:"),
        ),
    );
    await assert.rejects(
      manageDatabases("up", f.path, f.dependencies),
      /already exists/,
    );
    await manageDatabases("run", f.path, f.dependencies);
    assert.equal(f.suites.length, 3);
    assert.equal(
      f.suites[0].env.DBTUNA_POSTGRES_TEST_PASSWORD,
      state.entries[0].password,
    );
    assert.equal(
      f.suites[1].env.DBTUNA_SQLSERVER_TEST_PASSWORD,
      state.entries[1].password,
    );
    assert.equal(
      f.suites[2].env.DBTUNA_ORACLE_TEST_LIMITED_PASSWORD,
      state.entries[2].password,
    );
    assert.equal(f.containers.size, 4);
    await manageDatabases("down", f.path, f.dependencies);
    assert.equal(existsSync(f.path), false);
    assert.deepEqual([...f.containers.keys()], ["mssql-adventureworks"]);
    assert.ok(
      f.calls
        .filter((args) => args[0] === "rm")
        .every((args) => args.includes("--volumes")),
    );
    const removals = f.calls.filter((args) => args[0] === "rm").length;
    await manageDatabases("down", f.path, f.dependencies);
    assert.equal(f.calls.filter((args) => args[0] === "rm").length, removals);
  } finally {
    console.log = log;
  }
});
test("partial startup and initialization failures roll back the entire deployment", async (t) => {
  const { manageDatabases } = await load();
  for (const options of [{ failEngine: "sqlserver" }, { failPrepare: true }]) {
    const f = fixture(t, options);
    await assert.rejects(
      manageDatabases("up", f.path, f.dependencies),
      /cleaned up/,
    );
    assert.equal(existsSync(f.path), false);
    assert.deepEqual([...f.containers.keys()], ["mssql-adventureworks"]);
  }
});
test("cleanup retains state on ownership mismatch and can recover after missing containers", async (t) => {
  const { manageDatabases } = await load(),
    f = fixture(t);
  await manageDatabases("up", f.path, f.dependencies);
  const state = JSON.parse(readFileSync(f.path, "utf8")),
    sql = state.entries[1];
  const labels = f.containers.get(sql.name)!.labels;
  f.containers.get(sql.name)!.labels = {};
  await assert.rejects(
    manageDatabases("down", f.path, f.dependencies),
    /State retained/,
  );
  assert.ok(existsSync(f.path));
  assert.ok(f.containers.has(sql.name));
  assert.ok(
    !f.calls.some((args) => args[0] === "rm" && args.includes(sql.name)),
  );
  f.containers.get(sql.name)!.labels = labels;
  await manageDatabases("down", f.path, f.dependencies);
  assert.deepEqual([...f.containers.keys()], ["mssql-adventureworks"]);
});
test("running suites validates all container bindings and images before executing any tests", async (t) => {
  const { manageDatabases } = await load(),
    f = fixture(t);
  await manageDatabases("up", f.path, f.dependencies);
  const state = JSON.parse(readFileSync(f.path, "utf8"));
  const container = f.containers.get(state.entries[2].name)!;
  container.bindings["1521/tcp"][0].HostPort = "9999";
  await assert.rejects(
    manageDatabases("run", f.path, f.dependencies),
    /configuration changed/,
  );
  assert.equal(f.suites.length, 0);
  await manageDatabases("down", f.path, f.dependencies);
});
test("concurrent lifecycle commands are locked and invalid state never removes containers", async (t) => {
  const { manageDatabases } = await load(),
    f = fixture(t);
  const up = manageDatabases("up", f.path, f.dependencies);
  await assert.rejects(
    manageDatabases("down", f.path, f.dependencies),
    /Another test database command/,
  );
  await up;
  await manageDatabases("down", f.path, f.dependencies);
  writeFileSync(
    f.path,
    JSON.stringify({ version: 1, session: "bad", entries: [] }),
  );
  const count = f.calls.length;
  await assert.rejects(
    manageDatabases("down", f.path, f.dependencies),
    /Invalid test database state/,
  );
  assert.equal(f.calls.length, count);
});

test("sample seeding validates every target before dispatch and does not expose credentials", async (t) => {
  const { manageDatabases } = await load(),
    f = fixture(t);
  await manageDatabases("up", f.path, f.dependencies);
  const state = JSON.parse(readFileSync(f.path, "utf8"));
  const container = f.containers.get(state.entries[2].name)!;
  const image = container.image;
  container.image = "unexpected";
  await assert.rejects(
    manageDatabases("seed", f.path, f.dependencies),
    /configuration changed/,
  );
  assert.equal(f.suites.length, 0);
  container.image = image;
  await manageDatabases("seed", f.path, f.dependencies);
  assert.deepEqual(f.suites, [
    {
      args: ["--import", "tsx", "test/integration/seed-sample.mjs"],
      env: { DBTUNA_MANAGED_SAMPLE_SEED: "1", DBTUNA_TEST_STATE: f.path },
    },
  ]);
  await manageDatabases("down", f.path, f.dependencies);
});
