import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catalogQuery,
  normalizeMetadata,
  sqlServerMetadataSql,
  type MetadataKind,
} from "../../src/extension/metadata/catalog";
test("metadata catalogs bind object names and preserve native definitions", () => {
  const scope = { schema: "odd' schema", table: "odd'; DROP TABLE x;--" };
  for (const engine of ["postgresql", "sqlserver", "oracle"] as const) {
    for (const kind of [
      "schemas",
      "tables",
      "columns",
      "primaryKeys",
      "foreignKeys",
      "uniqueKeys",
      "indexes",
    ] as MetadataKind[]) {
      const query = catalogQuery(engine, kind, scope);
      assert.ok(!query.sql.includes(scope.schema));
      assert.ok(!query.sql.includes(scope.table));
      assert.equal(
        query.values.length,
        kind === "schemas" ? 0 : kind === "tables" ? 1 : 2,
      );
    }
  }
  const query = catalogQuery("sqlserver", "columns", scope);
  const sql = sqlServerMetadataSql(query);
  assert.ok(sql.includes("N'odd''; DROP TABLE x;--'"));
  assert.ok(!sql.includes("@p1"));
  assert.deepEqual(
    normalizeMetadata([
      ["MixedCase", "numeric(12,3) NOT NULL"],
      ["空", null],
    ]),
    [
      { name: "MixedCase", detail: "numeric(12,3) NOT NULL" },
      { name: "空", detail: "" },
    ],
  );
  assert.throws(() =>
    normalizeMetadata(Array.from({ length: 2001 }, () => ["x", ""])),
  );
  assert.throws(() => catalogQuery("oracle", "columns", {}));
});
