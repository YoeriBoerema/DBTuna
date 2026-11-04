import { createHash } from "node:crypto";
import oracledb from "oracledb";
import {
  withClient,
  clientConfig,
} from "../../src/extension/connection/postgresClient.ts";
import { withSqlServer } from "../../src/extension/connection/sqlServerClient.ts";
import { withOracle } from "../../src/extension/connection/oracleClient.ts";
import { UserFacingError } from "../../packages/plan-core/src/errors.ts";
import {
  catalogQuery,
  sqlServerMetadataSql,
  normalizeMetadata,
} from "../../src/extension/metadata/catalog.ts";
import {
  SAMPLE_SCHEMA,
  SAMPLE_TABLES,
  identifier,
  qualified,
  tableDDL,
  tableInserts,
  tableSelect,
  canonicalRows,
} from "../fixtures/sampleMetadata.mjs";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const lower = (value) => String(value).toLowerCase();
const expect = (condition, message) => {
  if (!condition) throw new UserFacingError(message);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function keyColumns(detail) {
  return detail
    .replace(/\[(ENABLED|DISABLED)\]/gi, "")
    .replace(/^(PRIMARY KEY|UNIQUE)\s*/i, "")
    .replace(/[()[\]"\s]/g, "")
    .toLowerCase()
    .split(",");
}
function profile(entry) {
  return {
    id: "managed-sample",
    name: "Managed sample database",
    type: entry.engine,
    host: "127.0.0.1",
    port: { postgresql: 55439, sqlserver: 55440, oracle: 55441 }[entry.engine],
    database: entry.engine === "oracle" ? "FREEPDB1" : "dbtuna_integration",
    user: {
      postgresql: "dbtuna",
      sqlserver: "sa",
      oracle: "dbtuna_integration",
    }[entry.engine],
    ssl: entry.engine === "sqlserver" ? "trust" : "disable",
  };
}
async function withAdapters(entries, action, adapters = [], index = 0) {
  if (index === entries.length) return action(adapters);
  const entry = entries[index],
    p = profile(entry),
    engine = entry.engine;
  const next = (query) =>
    withAdapters(
      entries,
      action,
      [...adapters, { entry, engine, query }],
      index + 1,
    );
  if (engine === "postgresql")
    return withClient(
      clientConfig(p, entry.password),
      (client) =>
        next(
          async (sql, values = []) =>
            (await client.query({ text: sql, values, rowMode: "array" })).rows,
        ),
      undefined,
      120000,
    );
  if (engine === "sqlserver")
    return withSqlServer(
      p,
      entry.password,
      (execute) => next(async (sql) => execute(sql)),
      undefined,
      120000,
    );
  return withOracle(
    p,
    entry.password,
    (connection, check) =>
      next(async (sql, values = []) => {
        check();
        const result = await connection.execute(sql, values, {
          outFormat: oracledb.OUT_FORMAT_ARRAY,
          maxRows: 2001,
        });
        check();
        return result.rows ?? [];
      }),
    undefined,
    180000,
  );
}
async function metadata(adapter, kind, table) {
  const schema =
    adapter.engine === "oracle" ? SAMPLE_SCHEMA.toUpperCase() : SAMPLE_SCHEMA;
  const query = catalogQuery(adapter.engine, kind, {
    schema,
    ...(table
      ? { table: adapter.engine === "oracle" ? table.toUpperCase() : table }
      : {}),
  });
  return normalizeMetadata(
    await adapter.query(
      adapter.engine === "sqlserver" ? sqlServerMetadataSql(query) : query.sql,
      query.values,
    ),
  );
}
async function schemaExists(adapter) {
  const sql =
    adapter.engine === "postgresql"
      ? `SELECT COUNT(*) FROM pg_namespace WHERE nspname='${SAMPLE_SCHEMA}'`
      : adapter.engine === "sqlserver"
        ? `SELECT COUNT(*) FROM sys.schemas WHERE name='${SAMPLE_SCHEMA}'`
        : `SELECT COUNT(*) FROM all_users WHERE username='${SAMPLE_SCHEMA.toUpperCase()}'`;
  return Number((await adapter.query(sql))[0][0]) !== 0;
}
function checksQuery(engine) {
  if (engine === "postgresql")
    return `SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace s ON s.oid=t.relnamespace WHERE s.nspname='${SAMPLE_SCHEMA}' AND c.contype='c'`;
  if (engine === "sqlserver")
    return `SELECT c.name FROM sys.check_constraints c JOIN sys.tables t ON t.object_id=c.parent_object_id JOIN sys.schemas s ON s.schema_id=t.schema_id WHERE s.name='${SAMPLE_SCHEMA}'`;
  return `SELECT constraint_name FROM all_constraints WHERE owner='${SAMPLE_SCHEMA.toUpperCase()}' AND constraint_type='C' AND generated='USER NAME'`;
}
export async function verifySample(adapter) {
  const tables = await metadata(adapter, "tables");
  expect(
    same(
      tables.map((t) => lower(t.name)).sort(),
      SAMPLE_TABLES.map((t) => t.name).sort(),
    ),
    `${adapter.engine}: sample namespace has different tables; existing data was not overwritten.`,
  );
  const summary = [];
  for (const table of SAMPLE_TABLES) {
    const columns = await metadata(adapter, "columns", table.name);
    expect(
      same(
        columns.map((c) => lower(c.name)),
        table.columns.map((c) => c.name),
      ),
      `${adapter.engine}: sample column structure differs in ${table.name}.`,
    );
    table.columns.forEach((column, index) => {
      const detail = columns[index].detail.toLowerCase();
      const typeMatches =
        column.type === "int"
          ? /^(integer|int\b|number\(10,0\))/.test(detail)
          : column.type === "date"
            ? /^date\b/.test(detail)
            : /^(character varying|varchar|nvarchar|varchar2)\(/.test(detail) &&
              Number(detail.match(/\((\d+)/)?.[1]) === column.length;
      expect(
        typeMatches && detail.includes("not null") === !column.nullable,
        `${adapter.engine}: sample type or nullability differs in ${table.name}.${column.name}.`,
      );
    });
    const primary = await metadata(adapter, "primaryKeys", table.name);
    expect(
      primary.length === 1 &&
        lower(primary[0].name) === `pk_${table.name}` &&
        same(keyColumns(primary[0].detail), table.primaryKey),
      `${adapter.engine}: sample primary key differs in ${table.name}.`,
    );
    const unique = await metadata(adapter, "uniqueKeys", table.name);
    expect(
      same(
        unique.map((k) => lower(k.name)).sort(),
        table.uniqueKeys.map((k) => k.name).sort(),
      ) &&
        unique.every((k) =>
          same(
            keyColumns(k.detail),
            table.uniqueKeys.find((wanted) => wanted.name === lower(k.name))
              ?.columns,
          ),
        ),
      `${adapter.engine}: sample unique keys differ in ${table.name}.`,
    );
    const actual = await adapter.query(tableSelect(adapter.engine, table));
    const expected = canonicalRows(table);
    expect(
      same(actual, expected),
      `${adapter.engine}: sample rows differ in ${table.name}; existing data was not overwritten.`,
    );
    summary.push({
      table: table.name,
      rows: actual.length,
      sha256: digest(actual),
    });
  }
  const foreign = await metadata(adapter, "relationships");
  const actualKeys = foreign
    .map((entry) => {
      const row = JSON.parse(entry.detail);
      return [
        entry.name,
        row.table,
        row.column,
        row.targetSchema,
        row.targetTable,
        row.targetColumn,
      ]
        .map(lower)
        .join("|");
    })
    .sort();
  const expectedKeys = SAMPLE_TABLES.flatMap((table) =>
    table.foreignKeys.flatMap((key) =>
      key.columns.map((column, index) =>
        [
          key.name,
          table.name,
          column,
          SAMPLE_SCHEMA,
          key.table,
          key.targets[index],
        ].join("|"),
      ),
    ),
  ).sort();
  expect(
    same(actualKeys, expectedKeys),
    `${adapter.engine}: sample foreign-key structure differs.`,
  );
  const checks = (await adapter.query(checksQuery(adapter.engine)))
    .map((row) => lower(row[0]))
    .sort();
  expect(
    same(
      checks,
      SAMPLE_TABLES.flatMap((table) =>
        (table.checks ?? []).map((check) => check.name),
      ).sort(),
    ),
    `${adapter.engine}: sample check constraints differ.`,
  );
  return {
    engine: adapter.engine,
    schema: SAMPLE_SCHEMA,
    tables: summary,
    rows: summary.reduce((sum, table) => sum + table.rows, 0),
    dataSha256: digest(summary),
  };
}
function oracleAdmin(entry, command, statements) {
  // SQL and credentials never enter stdout or command-line arguments.
  command(
    ["exec", "--interactive", entry.name, "sqlplus", "-s", "/ as sysdba"],
    {
      input: `SET ECHO OFF\nSET FEEDBACK OFF\nSET VERIFY OFF\nSET DEFINE OFF\nWHENEVER SQLERROR EXIT FAILURE ROLLBACK\nALTER SESSION SET CONTAINER = FREEPDB1;\n${statements.map((sql) => sql + ";").join("\n")}\nCOMMIT;\nEXIT;\n`,
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
}
async function createSample(adapter, command) {
  const engine = adapter.engine;
  let createdOracle = false;
  try {
    if (engine === "oracle") {
      oracleAdmin(adapter.entry, command, [
        `CREATE USER DBTUNA_SAMPLE NO AUTHENTICATION DEFAULT TABLESPACE users QUOTA 50M ON users`,
      ]);
      createdOracle = true;
      const statements = SAMPLE_TABLES.flatMap((table) => [
        tableDDL(engine, table),
        ...tableInserts(engine, table),
        ...table.foreignKeys.map(
          (key, i) =>
            `CREATE INDEX ${qualified(engine, `ix_${table.name}_${i + 1}`)} ON ${qualified(engine, table.name)} (${key.columns.map((column) => identifier(engine, column)).join(", ")})`,
        ),
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ${qualified(engine, table.name)} TO dbtuna_integration`,
      ]);
      oracleAdmin(adapter.entry, command, statements);
    } else {
      await adapter.query(
        engine === "postgresql"
          ? "BEGIN"
          : "SET XACT_ABORT ON; BEGIN TRANSACTION",
      );
      await adapter.query(
        engine === "postgresql"
          ? `CREATE SCHEMA ${identifier(engine, SAMPLE_SCHEMA)} AUTHORIZATION dbtuna`
          : `CREATE SCHEMA ${identifier(engine, SAMPLE_SCHEMA)} AUTHORIZATION dbo`,
      );
      for (const table of SAMPLE_TABLES) {
        await adapter.query(tableDDL(engine, table));
        for (const insert of tableInserts(engine, table))
          await adapter.query(insert);
        for (const [i, key] of table.foreignKeys.entries())
          await adapter.query(
            `CREATE INDEX ${identifier(engine, `ix_${table.name}_${i + 1}`)} ON ${qualified(engine, table.name)} (${key.columns.map((column) => identifier(engine, column)).join(", ")})`,
          );
      }
    }
    const result = await verifySample(adapter);
    if (engine !== "oracle") await adapter.query("COMMIT");
    return result;
  } catch (error) {
    if (engine !== "oracle")
      await adapter
        .query(
          engine === "postgresql"
            ? "ROLLBACK"
            : "IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION",
        )
        .catch(() => {});
    else if (createdOracle) {
      // Only roll back the namespace freshly created by this attempt; never drop an existing schema.
      try {
        oracleAdmin(adapter.entry, command, [
          "DROP USER DBTUNA_SAMPLE CASCADE",
        ]);
      } catch {
        throw new UserFacingError(
          "Oracle sample setup failed and its new namespace could not be rolled back. Keep the deployment and inspect it before retrying.",
        );
      }
    }
    throw error;
  }
}
export async function seedSampleDatabases(entries, command) {
  return withAdapters(entries, async (adapters) => {
    const existing = new Map();
    // Check every existing namespace before changing any engine.
    for (const adapter of adapters) {
      if (await schemaExists(adapter))
        existing.set(adapter.engine, await verifySample(adapter));
    }
    const reports = [];
    for (const adapter of adapters) {
      const result =
        existing.get(adapter.engine) ?? (await createSample(adapter, command));
      reports.push(result);
      console.log(
        `${adapter.engine}: ${result.tables.length} sample tables, ${result.rows} rows ${existing.has(adapter.engine) ? "already matched" : "seeded and verified"}.`,
      );
    }
    expect(
      new Set(reports.map((report) => report.dataSha256)).size === 1,
      "Sample data hashes differ between database engines.",
    );
    return {
      schema: SAMPLE_SCHEMA,
      tables: SAMPLE_TABLES.length,
      rowsPerDatabase: reports[0].rows,
      dataSha256: reports[0].dataSha256,
      databases: reports,
    };
  });
}
