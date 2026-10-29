// Run the remediation regressions against the current checkout.
// The original vulnerable-behavior probes were executed against commit
// 313408077937bd586aceaba7a1d489dcc01db1ec during the historical review.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "test/unit/security.test.ts",
    "test/unit/postgres-budget.test.ts",
  ],
  {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdio: "inherit",
    windowsHide: true,
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
