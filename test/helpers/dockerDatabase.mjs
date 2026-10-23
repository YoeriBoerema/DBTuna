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

export async function withDockerDatabase(config, action, command = docker) {
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
  const token = randomBytes(6).toString("hex"),
    name = `dbtuna-${engine}-test-${token}`;
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
    return await action(container);
  } finally {
    if (created) {
      const labels = JSON.parse(
        command(["inspect", "--format", "{{json .Config.Labels}}", name]),
      );
      if (
        labels["dbtuna.integration"] !== engine ||
        labels["dbtuna.integration.run"] !== token
      )
        throw Error(
          "Refusing to remove a container without matching test ownership labels.",
        );
      command(["rm", "--force", "--volumes", name]);
      console.log(`Removed disposable ${engine} container and database.`);
    }
  }
}
