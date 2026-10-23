import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export function packageInfo(root = process.cwd()) {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  );
  return {
    manifest,
    filename: `${manifest.name}-${manifest.version}.vsix`,
    output: resolve(root, "..", `${manifest.name}-${manifest.version}.vsix`),
  };
}
