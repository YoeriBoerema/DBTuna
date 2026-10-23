import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import type { DatabaseExplorer as Explorer } from "../../src/extension/metadata/databaseExplorer";
import type { Profile } from "../../src/extension/connection/profile";
import type { MetadataEntry } from "../../src/extension/metadata/catalog";
test("explorer loads lazily, caches folders and discards cancelled stale metadata", async () => {
  const bundle = await build({
    entryPoints: ["src/extension/metadata/databaseExplorer.ts"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    packages: "external",
    plugins: [
      {
        name: "vscode-stub",
        setup(builder) {
          builder.onResolve({ filter: /^vscode$/ }, () => ({
            path: "vscode",
            namespace: "stub",
          }));
          builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: `exports.workspace={isTrusted:true};exports.EventEmitter=class {event=()=>({dispose(){}});fire(){}dispose(){}};exports.TreeItem=class{constructor(label,state){this.label=label;this.collapsibleState=state}};exports.TreeItemCollapsibleState={None:0,Collapsed:1};exports.ThemeIcon=class{};`,
          }));
        },
      },
    ],
  });
  const module = { exports: {} as { DatabaseExplorer: typeof Explorer } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  const profile: Profile = {
    id: "test",
    name: "Test connection",
    type: "postgresql",
    host: "localhost",
    port: 5432,
    database: "test",
    user: "test",
    ssl: "disable",
  };
  let calls = 0;
  let signal: AbortSignal | undefined;
  let resolve: ((entries: MetadataEntry[]) => void) | undefined;
  const explorer = new module.exports.DatabaseExplorer(
    { profiles: () => [profile], password: async () => "secret" },
    async (_p, _password, _kind, _scope, requestSignal) => {
      calls++;
      signal = requestSignal;
      return new Promise((done) => {
        resolve = done;
      });
    },
  );
  try {
    const roots = await explorer.getChildren();
    assert.equal(calls, 0);
    assert.equal(roots[0].label, "Test connection");
    assert.equal(
      explorer.getTreeItem(roots[0]).contextValue,
      "dbtuna.database",
    );
    const pending = explorer.getChildren(roots[0]);
    await new Promise((done) => setImmediate(done));
    const same = explorer.getChildren(roots[0]);
    assert.equal(calls, 1);
    resolve!([{ name: "public", detail: "" }]);
    const schemas = await pending;
    assert.equal(explorer.getTreeItem(schemas[0]).contextValue, undefined);
    assert.deepEqual(await same, schemas);
    await explorer.getChildren(roots[0]);
    assert.equal(calls, 1);
    const tablesPending = explorer.getChildren(schemas[0]);
    await new Promise((done) => setImmediate(done));
    explorer.refresh();
    assert.equal(signal!.aborted, true);
    resolve!([{ name: "stale", detail: "" }]);
    assert.deepEqual(await tablesPending, []);
    const reloaded = explorer.getChildren(roots[0]);
    await new Promise((done) => setImmediate(done));
    assert.equal(calls, 3);
    resolve!([{ name: "fresh", detail: "" }]);
    assert.equal((await reloaded)[0].label, "fresh");
  } finally {
    explorer.dispose();
  }
});
