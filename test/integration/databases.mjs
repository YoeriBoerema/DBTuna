import { runNode } from "../helpers/run.mjs";
// Sequential databases keep peak memory bounded; every runner owns its cleanup.
for (const file of [
  "postgres-docker.mjs",
  "sqlserver-docker.mjs",
  "oracle-docker.mjs",
])
  runNode([`test/integration/${file}`]);
