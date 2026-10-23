import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";

test("package filenames track the supplied manifest instead of a release constant", async () => {
  const { packageInfo } = await import(
    new URL("../../scripts/package-info.mjs", import.meta.url).href
  );
  const workspace = resolve("work");
  mkdirSync(workspace, { recursive: true });
  const folder = mkdtempSync(resolve(workspace, "package-test-"));
  try {
    writeFileSync(
      resolve(folder, "package.json"),
      JSON.stringify({ name: "custom", version: "9.8.7" }),
    );
    const info = packageInfo(folder);
    assert.equal(info.filename, "custom-9.8.7.vsix");
    assert.equal(info.output, resolve(workspace, info.filename));
  } finally {
    if (!folder.startsWith(workspace + sep))
      throw Error("Unexpected test directory");
    rmSync(folder, { recursive: true, force: true });
  }
});
