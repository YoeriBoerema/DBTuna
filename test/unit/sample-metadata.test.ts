import { test } from "node:test";
import assert from "node:assert/strict";
type Value = string | number | null;
interface Table {
  name: string;
  columns: { name: string; type: string; nullable: boolean; length: number }[];
  primaryKey: string[];
  uniqueKeys: { columns: string[] }[];
  foreignKeys: { columns: string[]; table: string; targets: string[] }[];
  rows: Value[][];
}
interface Sample {
  SAMPLE_TABLES: Table[];
  canonicalRows(table: Table): Value[][];
  tableDDL(engine: string, table: Table): string;
  tableInserts(engine: string, table: Table): string[];
  tableSelect(engine: string, table: Table): string;
  identifier(engine: string, name: string): string;
}
const load = (): Promise<Sample> =>
  import(new URL("../fixtures/sampleMetadata.mjs", import.meta.url).href);

test("sample metadata has bounded row counts, valid keys and no dangling relationships", async () => {
  const { SAMPLE_TABLES: tables, canonicalRows } = await load();
  assert.equal(tables.length, 10);
  assert.equal(
    tables.reduce((n: number, t) => n + t.rows.length, 0),
    1520,
  );
  let foreignKeys = 0;
  for (const table of tables) {
    assert.ok(table.rows.length >= 100 && table.rows.length <= 250);
    const key = (row: Value[], columns: string[]) =>
      JSON.stringify(
        columns.map((c) => row[table.columns.findIndex((v) => v.name === c)]),
      );
    for (const columns of [
      table.primaryKey,
      ...table.uniqueKeys.map((k) => k.columns),
    ])
      assert.equal(
        new Set(table.rows.map((r: Value[]) => key(r, columns))).size,
        table.rows.length,
      );
    for (const row of table.rows) {
      assert.equal(row.length, table.columns.length);
      table.columns.forEach((column, i: number) => {
        if (row[i] === null) assert.ok(column.nullable);
        else if (column.type === "text")
          assert.ok(String(row[i]).length <= column.length);
        else if (column.type === "int") assert.ok(Number.isSafeInteger(row[i]));
        else
          assert.equal(
            new Date(String(row[i])).toISOString().slice(0, 10),
            row[i],
          );
      });
    }
    for (const fk of table.foreignKeys) {
      foreignKeys++;
      const target = tables.find((t) => t.name === fk.table);
      assert.ok(target);
      const allowed = new Set(
        target.rows.map((r: Value[]) =>
          JSON.stringify(
            fk.targets.map(
              (c: string) => r[target.columns.findIndex((v) => v.name === c)],
            ),
          ),
        ),
      );
      for (const row of table.rows) {
        const values = fk.columns.map(
          (c: string) => row[table.columns.findIndex((v) => v.name === c)],
        );
        if (values.every((v) => v !== null))
          assert.ok(allowed.has(JSON.stringify(values)));
      }
    }
    assert.deepEqual(
      canonicalRows(table),
      canonicalRows({ ...table, rows: [...table.rows].reverse() }),
    );
  }
  assert.equal(foreignKeys, 15);
});
test("sample SQL maps the same model to each dialect and escapes data", async () => {
  const {
    SAMPLE_TABLES: tables,
    tableDDL,
    tableInserts,
    tableSelect,
    identifier,
  } = await load();
  for (const engine of ["postgresql", "sqlserver", "oracle"]) {
    for (const table of tables) {
      assert.match(tableDDL(engine, table), /CREATE TABLE/);
      assert.match(tableSelect(engine, table), /ORDER BY/);
      assert.ok(tableInserts(engine, table).length > 0);
    }
    assert.match(tableInserts(engine, tables[0]).join("\n"), /Alex O''Connell/);
    assert.throws(() => identifier(engine, "unsafe;identifier"));
  }
});
