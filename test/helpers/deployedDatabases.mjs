import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  databaseEngines,
  databaseDefinition,
  databasePassword,
} from "./databaseEngines.mjs";
import {
  docker,
  planDockerDatabase,
  startDockerDatabase,
  removeDockerDatabase,
  inspectOwnedDatabase,
} from "./dockerDatabase.mjs";
import { runNode } from "./run.mjs";

function readState(path) {
  let state;
  try {
    state = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw Error(
      "Could not read test database state. Keep the file for recovery.",
    );
  }
  if (
    state?.version !== 1 ||
    !/^[a-f0-9]{12}$/.test(state.session) ||
    !Array.isArray(state.entries) ||
    state.entries.length > 3
  )
    throw Error("Invalid test database state. No containers were changed.");
  const engines = new Set();
  for (const entry of state.entries) {
    if (
      !databaseEngines.includes(entry.engine) ||
      engines.has(entry.engine) ||
      !/^[a-f0-9]{12}$/.test(entry.token) ||
      entry.name !== `dbtuna-${entry.engine}-test-${entry.token}` ||
      !/^T[a-f0-9]{24}a1!$/.test(entry.password)
    )
      throw Error(
        "Invalid test database ownership state. No containers were changed.",
      );
    engines.add(entry.engine);
  }
  return state;
}
function persist(path, state) {
  const temporary = `${path}.${state.session}.tmp`;
  writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", {
    mode: 0o600,
  });
  renameSync(temporary, path);
}
async function locked(path, action) {
  mkdirSync(dirname(path), { recursive: true });
  const lock = path + ".lock",
    token = randomBytes(6).toString("hex");
  let file;
  try {
    file = openSync(lock, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let previous;
    try {
      previous = JSON.parse(readFileSync(lock, "utf8"));
    } catch {
      throw Error(
        "A test database lock exists. Check that no database command is running before removing the lock file.",
      );
    }
    if (!Number.isSafeInteger(previous.pid) || previous.pid < 1)
      throw Error("Invalid test database lock.");
    try {
      process.kill(previous.pid, 0);
      throw Error(
        "Another test database command is running for this checkout.",
      );
    } catch (running) {
      if (running.code !== "ESRCH") throw running;
    }
    // Only remove the same stale lock that was inspected above.
    if (JSON.parse(readFileSync(lock, "utf8")).token !== previous.token)
      throw Error("Test database lock changed; retry the command.");
    unlinkSync(lock);
    file = openSync(lock, "wx", 0o600);
  }
  writeFileSync(file, JSON.stringify({ pid: process.pid, token }));
  closeSync(file);
  try {
    return await action();
  } finally {
    if (
      existsSync(lock) &&
      JSON.parse(readFileSync(lock, "utf8")).token === token
    )
      unlinkSync(lock);
  }
}
function cleanup(state, command) {
  const failures = [];
  for (const entry of [...state.entries].reverse()) {
    try {
      removeDockerDatabase(entry, command, true);
    } catch {
      failures.push(entry.engine);
    }
  }
  return failures;
}
export async function manageDatabases(action, path, dependencies = {}) {
  const command = dependencies.command ?? docker;
  const execute = dependencies.run ?? runNode;
  if (!["up", "down", "run", "seed"].includes(action))
    throw Error("Use up, down, run or seed for deployed test databases.");
  return locked(path, async () => {
    if (action === "down") {
      if (!existsSync(path)) {
        console.log("No deployed test databases for this checkout.");
        return;
      }
      const state = readState(path),
        failures = cleanup(state, command);
      if (failures.length)
        throw Error(
          `Could not clean up ${failures.join(", ")}. State retained; rerun test:databases:down after checking Docker and ownership.`,
        );
      unlinkSync(path);
      console.log(
        "All deployed test databases and their anonymous data volumes have been removed.",
      );
      return;
    }
    if (action === "run" || action === "seed") {
      if (!existsSync(path))
        throw Error(
          "No deployed test databases. Run npm run test:databases:up first.",
        );
      const state = readState(path);
      if (
        state.entries.length !== 3 ||
        state.entries.some((entry) => entry.ready !== true)
      )
        throw Error(
          "Deployment is incomplete. Clean up with test:databases:down and deploy again.",
        );
      // Validate every target before running any test suite against its fixed local port.
      for (const entry of state.entries) {
        const definition = databaseDefinition(entry.engine, entry.password);
        inspectOwnedDatabase(entry, command);
        const running = JSON.parse(
          command(["inspect", "--format", "{{json .State}}", entry.name]),
        );
        const bindings = JSON.parse(
          command([
            "inspect",
            "--format",
            "{{json .HostConfig.PortBindings}}",
            entry.name,
          ]),
        );
        const published = bindings?.[`${definition.config.containerPort}/tcp`];
        const image = command([
          "inspect",
          "--format",
          "{{.Config.Image}}",
          entry.name,
        ]);
        if (
          !running.Running ||
          image !== definition.config.image ||
          published?.length !== 1 ||
          published[0].HostIp !== "127.0.0.1" ||
          published[0].HostPort !== String(definition.config.port)
        )
          throw Error(
            "A deployed test database has stopped or its isolated configuration changed. Clean up and deploy again.",
          );
      }
      if (action === "seed") {
        execute(["--import", "tsx", "test/integration/seed-sample.mjs"], {
          DBTUNA_MANAGED_SAMPLE_SEED: "1",
          DBTUNA_TEST_STATE: path,
        });
        return;
      }
      for (const entry of state.entries) {
        const definition = databaseDefinition(entry.engine, entry.password);
        console.log(`Running the deployed ${entry.engine} integration suite.`);
        execute(
          ["--import", "tsx", "--test", definition.testFile],
          definition.testEnvironment,
        );
      }
      return;
    }
    if (existsSync(path))
      throw Error(
        "A deployment already exists for this checkout. Run npm run test:databases:down before creating fresh databases.",
      );
    command(["info", "--format", "{{.ServerVersion}}"]);
    const state = {
      version: 1,
      session: randomBytes(6).toString("hex"),
      entries: [],
    };
    writeFileSync(path, JSON.stringify(state), { flag: "wx", mode: 0o600 });
    try {
      for (const engine of databaseEngines) {
        const password = databasePassword(),
          definition = databaseDefinition(engine, password);
        // Record ownership before creating Docker resources, including recovery after interruption.
        const entry = {
          ...planDockerDatabase(definition.config),
          password,
          connection: definition.connection,
          ready: false,
        };
        state.entries.push(entry);
        persist(path, state);
        const container = await startDockerDatabase(
          definition.config,
          entry,
          command,
        );
        await definition.prepare(container);
        entry.ready = true;
        persist(path, state);
        console.log(`${engine} ready at 127.0.0.1:${definition.config.port}.`);
      }
    } catch {
      const failures = cleanup(state, command);
      if (!failures.length) unlinkSync(path);
      throw Error(
        failures.length
          ? "Deployment failed and cleanup is incomplete. State retained; run npm run test:databases:down."
          : "Deployment failed. All containers created by this deployment were cleaned up. Check Docker, available memory and port availability.",
      );
    }
    console.log(
      "All test databases are ready and will remain running until test:databases:down.",
    );
    console.log(
      `Local connection details and generated passwords are in ${path}. Keep this ignored file private.`,
    );
  });
}
