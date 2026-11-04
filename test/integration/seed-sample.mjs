import { UserFacingError } from "../../packages/plan-core/src/errors.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { docker, inspectOwnedDatabase } from "../helpers/dockerDatabase.mjs";
import {
  databaseDefinition,
  databaseEngines,
} from "../helpers/databaseEngines.mjs";
import { seedSampleDatabases } from "../helpers/sampleDatabases.mjs";
try {
  if (
    process.env.DBTUNA_MANAGED_SAMPLE_SEED !== "1" ||
    !process.env.DBTUNA_TEST_STATE
  )
    throw Error(
      "Use npm run test:databases:seed to seed a managed deployment.",
    );
  const state = JSON.parse(readFileSync(process.env.DBTUNA_TEST_STATE, "utf8"));
  if (
    state.version !== 1 ||
    state.entries?.length !== 3 ||
    new Set(state.entries.map((entry) => entry.engine)).size !== 3
  )
    throw Error("Invalid managed deployment state.");
  for (const entry of state.entries) {
    if (!databaseEngines.includes(entry.engine) || entry.ready !== true)
      throw Error("Test deployment is incomplete.");
    inspectOwnedDatabase(entry);
    const config = databaseDefinition(entry.engine, entry.password).config;
    const bindings = JSON.parse(
      docker([
        "inspect",
        "--format",
        "{{json .HostConfig.PortBindings}}",
        entry.name,
      ]),
    )[`${config.containerPort}/tcp`];
    const running = JSON.parse(
      docker(["inspect", "--format", "{{json .State}}", entry.name]),
    );
    if (
      !running.Running ||
      bindings?.length !== 1 ||
      bindings[0].HostIp !== "127.0.0.1" ||
      bindings[0].HostPort !== String(config.port) ||
      docker(["inspect", "--format", "{{.Config.Image}}", entry.name]) !==
        config.image
    )
      throw Error(
        "Managed database configuration changed; no seeding was performed.",
      );
  }
  const report = await seedSampleDatabases(state.entries, docker);
  const output = join(
    dirname(process.env.DBTUNA_TEST_STATE),
    "sample-data-report.json",
  );
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `All three databases contain identical sample data. SHA-256: ${report.dataSha256}`,
  );
  console.log(`Verification report: ${output}`);
} catch (error) {
  // Never print native driver errors or their SQL/credential-bearing causes.
  console.error(
    error instanceof UserFacingError
      ? error.message
      : "Could not seed the managed sample data. Check the deployment and existing dbtuna_sample namespace; no existing namespace is overwritten.",
  );
  process.exitCode = 1;
}
