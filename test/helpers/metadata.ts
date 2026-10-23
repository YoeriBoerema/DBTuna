import assert from "node:assert/strict";
import type { Profile } from "../../src/extension/connection/profile";
import { readMetadata } from "../../src/extension/metadata/readMetadata";
export async function verifyMetadata(
  profile: Profile,
  password: string,
  execute: (sql: string) => Promise<unknown>,
) {
  const oracle = profile.type === "oracle";
  const schema = oracle
    ? profile.user.toUpperCase()
    : profile.type === "postgresql"
      ? "public"
      : "dbo";
  const parent = oracle ? "META_PARENT" : "meta_parent";
  const child = oracle ? "META'CHILD" : "meta'child";
  const quote = (name: string) =>
    profile.type === "sqlserver"
      ? "[" + name.replaceAll("]", "]]") + "]"
      : '"' + name.replaceAll('"', '""') + '"';
  const qualified = (name: string) => quote(schema) + "." + quote(name);
  const scope = { schema, table: child };
  const read = (kind: Parameters<typeof readMetadata>[2], target = scope) =>
    readMetadata(profile, password, kind, target, new AbortController().signal);
  await execute(
    `CREATE TABLE ${qualified(parent)} (a int, b int, CONSTRAINT meta_parent_pk PRIMARY KEY(a,b))`,
  );
  try {
    await execute(
      `CREATE TABLE ${qualified(child)} (a int, b int, label varchar(30), CONSTRAINT meta_child_pk PRIMARY KEY(a,b), CONSTRAINT meta_child_uq UNIQUE(label), CONSTRAINT meta_child_fk FOREIGN KEY(a,b) REFERENCES ${qualified(parent)}(a,b))`,
    );
    try {
      assert.ok((await read("schemas")).some((x) => x.name === schema));
      assert.ok((await read("tables")).some((x) => x.name === child));
      const columns = await read("columns");
      assert.deepEqual(
        columns.map((x) => x.name.toLowerCase()),
        ["a", "b", "label"],
      );
      assert.match(columns[0].detail, /NOT NULL/);
      const pk = await read("primaryKeys");
      assert.equal(pk.length, 1);
      assert.match(pk[0].detail, /a.*b/i);
      const fk = await read("foreignKeys");
      assert.equal(fk.length, 1);
      assert.match(fk[0].detail, /meta_parent/i);
      assert.match(fk[0].detail, /a.*b/i);
      assert.equal((await read("uniqueKeys")).length, 1);
      assert.ok((await read("indexes")).length >= 2);
      assert.deepEqual(
        await read("tables", { schema: "missing' schema", table: child }),
        [],
      );
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(() =>
        readMetadata(profile, password, "tables", scope, controller.signal),
      );
      console.log(
        `Verified ${profile.type} metadata: schemas, quoted tables, column order/types, composite PK/FK, unique constraints, indexes and cancellation.`,
      );
    } finally {
      await execute(`DROP TABLE ${qualified(child)}`);
    }
  } finally {
    await execute(`DROP TABLE ${qualified(parent)}`);
  }
}
