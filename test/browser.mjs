import { runNode } from "./helpers/run.mjs";
const environment = {
  DBTUNA_UPDATE_SCREENSHOTS: process.argv.includes("--update-screenshots")
    ? "1"
    : "0",
};
for (const file of [
  "render.mjs",
  "render-ai.mjs",
  "render-execution.mjs",
  "render-sqlserver.mjs",
  "render-analysis.mjs",
  "render-doom.mjs",
])
  runNode([`test/${file}`], environment);
