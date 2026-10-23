import { test } from "node:test";
import assert from "node:assert/strict";
import {
  relationshipGraph,
  databaseRelationshipGraph,
} from "../../src/extension/metadata/relationshipGraph";
import { readDatabaseRelationships } from "../../src/extension/metadata/readRelationships";
import type { Profile } from "../../src/extension/connection/profile";
import {
  catalogQuery,
  sqlServerMetadataSql,
} from "../../src/extension/metadata/catalog";
test("relationship graph preserves composite, self and cross-schema keys and disconnected tables", () => {
  const tables = ["orders", "customers", "isolated"].map((name) => ({
    name,
    detail: "",
  }));
  const row = (
    name: string,
    table: string,
    column: string,
    targetSchema: string,
    targetTable: string,
    targetColumn: string,
  ) => ({
    name,
    detail: JSON.stringify({
      table,
      column,
      targetSchema,
      targetTable,
      targetColumn,
    }),
  });
  const graph = relationshipGraph("sales", tables, [
    row("customer", "orders", "customer_id", "sales", "customers", "id"),
    row("customer", "orders", "tenant_id", "sales", "customers", "tenant_id"),
    row("parent", "customers", "parent_id", "sales", "customers", "id"),
    row("address", "orders", "address_id", "other", "addresses", "id"),
    row("hidden", "hidden", "id", "other", "hidden", "id"),
  ]);
  assert.equal(graph.tables.length, 4);
  assert.equal(graph.relationships.length, 3);
  assert.deepEqual(graph.relationships[0].columns, [
    "customer_id → id",
    "tenant_id → tenant_id",
  ]);
  assert.deepEqual(graph.relationships[0].columnPairs, [
    { source: "customer_id", target: "id" },
    { source: "tenant_id", target: "tenant_id" },
  ]);
  assert.equal(graph.relationships[1].source, graph.relationships[1].target);
  assert.equal(
    graph.tables.find((t) => t.name === "addresses")?.external,
    true,
  );
  assert.deepEqual(
    graph.tables.find((t) => t.name === "isolated")?.columns,
    [],
  );
});

test("database graph merges all schemas without duplicate referenced tables or constraint IDs", () => {
  const row = (targetSchema: string) => ({
    name: "same_fk",
    detail: JSON.stringify({
      table: "items",
      column: "parent_id",
      targetSchema,
      targetTable: "items",
      targetColumn: "id",
    }),
  });
  const graph = databaseRelationshipGraph("entire database", [
    {
      schema: "a",
      tables: [
        { name: "items", detail: "" },
        { name: "isolated", detail: "" },
      ],
      rows: [row("b")],
    },
    { schema: "b", tables: [{ name: "items", detail: "" }], rows: [row("a")] },
  ]);
  assert.equal(graph.schema, "entire database");
  assert.equal(graph.tables.length, 3);
  assert.equal(new Set(graph.relationships.map((r) => r.id)).size, 2);
  assert.ok(graph.tables.every((t) => !t.external));
  assert.deepEqual(graph.tables.find((t) => t.schema === "b")?.columns, [
    "id",
    "parent_id",
  ]);
});

test("database metadata loads every visible schema using the selected connection and supports cancellation", async () => {
  const profile = { id: "selected", database: "entire database" } as Profile;
  const calls: string[] = [];
  const controller = new AbortController();
  const graph = await readDatabaseRelationships(
    profile,
    "secret",
    controller.signal,
    async (p, password, kind, scope) => {
      assert.equal(p, profile);
      assert.equal(password, "secret");
      calls.push(`${kind}:${scope.schema ?? ""}`);
      if (kind === "schemas")
        return [
          { name: "a", detail: "" },
          { name: "b", detail: "" },
        ];
      return kind === "tables" ? [{ name: "items", detail: "" }] : [];
    },
  );
  assert.equal(graph.tables.length, 2);
  assert.deepEqual(calls, [
    "schemas:",
    "tables:a",
    "relationships:a",
    "tables:b",
    "relationships:b",
  ]);
  controller.abort();
  await assert.rejects(
    () =>
      readDatabaseRelationships(
        profile,
        undefined,
        controller.signal,
        async () => {
          throw Error("Must not read after cancellation");
        },
      ),
    /Cancelled/,
  );
});
test("relationship catalogs bind schema names and graph input is bounded", () => {
  for (const engine of ["postgresql", "sqlserver", "oracle"] as const) {
    const query = catalogQuery(engine, "relationships", { schema: "a'b" });
    assert.deepEqual(query.values, ["a'b"]);
    assert.ok(!query.sql.includes("a'b"));
    if (engine === "sqlserver")
      assert.ok(sqlServerMetadataSql(query).includes("N'a''b'"));
  }
  assert.throws(() =>
    relationshipGraph("s", [], [{ name: "bad", detail: "invalid" }]),
  );
  assert.throws(
    () =>
      relationshipGraph(
        "s",
        Array.from({ length: 2001 }, (_, i) => ({
          name: String(i),
          detail: "",
        })),
        [],
      ),
    /2,000/,
  );
});
