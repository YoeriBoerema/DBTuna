import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export function docker(args, options = {}) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
    ...options,
  });
  // CLI output can contain setup SQL/passwords. Report the operation only.
  if (result.error || result.status !== 0)
    throw Error("Test Docker command failed: " + args[0]);
  return result.stdout.trim();
}

export function planDockerDatabase(config) {
  if (
    !["postgresql", "oracle", "sqlserver"].includes(config.engine) ||
    !/@sha256:[a-f0-9]{64}$/.test(config.image)
  )
    throw Error(
      "Test databases require a known engine and pinned image digest.",
    );
  const token = randomBytes(6).toString("hex");
  return {
    engine: config.engine,
    token,
    name: `dbtuna-${config.engine}-test-${token}`,
  };
}
function validateIdentity(identity) {
  if (
    !identity ||
    !["postgresql", "oracle", "sqlserver"].includes(identity.engine) ||
    !/^[a-f0-9]{12}$/.test(identity.token) ||
    identity.name !== `dbtuna-${identity.engine}-test-${identity.token}`
  )
    throw Error("Invalid test database ownership identity.");
}
export function inspectOwnedDatabase(identity, command = docker) {
  validateIdentity(identity);
  const labels = JSON.parse(
    command(["inspect", "--format", "{{json .Config.Labels}}", identity.name]),
  );
  if (
    labels?.["dbtuna.integration"] !== identity.engine ||
    labels?.["dbtuna.integration.run"] !== identity.token
  )
    throw Error(
      "Refusing to manage a container without matching test ownership labels.",
    );
}
export function removeDockerDatabase(
  identity,
  command = docker,
  allowMissing = false,
) {
  validateIdentity(identity);
  if (
    allowMissing &&
    !command([
      "container",
      "ls",
      "--all",
      "--quiet",
      "--filter",
      `name=^/${identity.name}$`,
    ])
  )
    return;
  inspectOwnedDatabase(identity, command);
  command(["rm", "--force", "--volumes", identity.name]);
  console.log(`Removed disposable ${identity.engine} container and database.`);
}
export async function startDockerDatabase(
  config,
  identity = planDockerDatabase(config),
  command = docker,
) {
  const {
    engine,
    image,
    port,
    containerPort,
    environment = {},
    runArgs = [],
    ready,
  } = config;
  if (
    !["postgresql", "oracle", "sqlserver"].includes(engine) ||
    !/@sha256:[a-f0-9]{64}$/.test(image)
  )
    throw Error(
      "Test databases require a known engine and pinned image digest.",
    );
  validateIdentity(identity);
  if (identity.engine !== engine)
    throw Error("Test database identity does not match the engine.");
  const { token, name } = identity;
  const container = {
    name,
    command: (args, options) => command(args, options),
  };
  let created = false;
  try {
    try {
      command(["image", "inspect", image]);
    } catch {
      console.log(`Downloading the pinned ${engine} test image.`);
      command(["pull", image], { timeout: 600000 });
    }
    // Create separately so a start/bind failure can still clean up its container.
    command(
      [
        "create",
        "--name",
        name,
        "--label",
        `dbtuna.integration=${engine}`,
        "--label",
        `dbtuna.integration.run=${token}`,
        "--publish",
        `127.0.0.1:${port}:${containerPort}`,
        "--memory",
        "3g",
        "--cpus",
        "2",
        ...runArgs,
        ...Object.keys(environment).flatMap((key) => ["--env", key]),
        image,
      ],
      { env: { ...process.env, ...environment } },
    );
    created = true;
    command(["start", name]);
    console.log(`Starting disposable ${engine} on 127.0.0.1:${port}.`);
    const deadline = Date.now() + 240000;
    for (;;) {
      const state = JSON.parse(
        command(["inspect", "--format", "{{json .State}}", name]),
      );
      if (!state.Running)
        throw Error(`Disposable ${engine} exited before readiness.`);
      if (await ready(container, state)) break;
      if (Date.now() >= deadline)
        throw Error(
          `Disposable ${engine} did not become ready within four minutes.`,
        );
      await delay(2000);
    }
    return container;
  } catch (error) {
    if (created) removeDockerDatabase(identity, command);
    throw error;
  }
}
export async function withDockerDatabase(config, action, command = docker) {
  const identity = planDockerDatabase(config);
  const container = await startDockerDatabase(config, identity, command);
  try {
    return await action(container);
  } finally {
    removeDockerDatabase(identity, command);
  }
}
