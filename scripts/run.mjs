import { spawnSync } from "node:child_process";
export function runNode(args, environment = {}) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, ...environment },
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(`Check failed: ${args.join(" ")} (${result.status})`);
}
