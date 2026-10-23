import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import {
  OracleAdapter,
  type OracleEnvelope,
} from "../../packages/adapter-oracle/src/oracleAdapter";
import { parseOracleText } from "../../packages/adapter-oracle/src/oracleText";
import { analyzePlan } from "../../packages/plan-analysis/src/analyze";
import { oracleFacts } from "../../packages/plan-analysis/src/oracleFacts";
import { validate } from "../../packages/plan-core/src/schema";
import {
  splitOracle,
  validateOracle,
  maskOracle,
} from "../../src/extension/sql/oracleSelection";
import { prepareBatch } from "../../src/extension/services/batchExplain";
import { databaseConnector } from "../../src/extension/connectors/registry";
import {
  profileSchema,
  sameConnection,
} from "../../src/extension/connection/profile";
import {
  oracleConfig,
  collectOraclePlan,
  withOracle,
  type OracleConnection,
  type OracleDriver,
} from "../../src/extension/connection/oracleClient";
import { advicePayload } from "../../src/extension/ai/advicePayload";
import { AdapterRegistry } from "../../packages/adapter-sdk/src/registry";

const adapter = new OracleAdapter();
const parsedProfile = profileSchema.parse({
  type: "oracle",
  id: "oracle-test",
  name: "Isolated Oracle",
  host: "127.0.0.1",
  port: 55441,
  database: "FREEPDB1",
  user: "dbtuna_integration",
  ssl: "disable",
});
if (parsedProfile.type !== "oracle")
  throw Error("Expected Oracle fixture profile.");
const profile = parsedProfile;
function native(actual = false): OracleEnvelope {
  return {
    kind: "dbtuna-oracle-native",
    nativeVersion: 1,
    planKind: actual ? "actual" : "estimated",
    query: "SELECT * FROM customers ORDER BY name",
    version: "19.0",
    rows: [
      {
        ID: 0,
        PARENT_ID: null,
        OPERATION: "SELECT STATEMENT",
        COST: 100,
        CARDINALITY: 200000,
      },
      {
        ID: 1,
        PARENT_ID: 0,
        OPERATION: "SORT",
        OPTIONS: "ORDER BY",
        COST: 100,
        CARDINALITY: 200000,
        BYTES: 20000000,
        ...(actual
          ? {
              LAST_STARTS: 1,
              LAST_OUTPUT_ROWS: 200000,
              LAST_ELAPSED_TIME: 1234000,
              LAST_TEMPSEG_SIZE: 100000,
              LAST_EXECUTION: "ONE PASS",
            }
          : {}),
      },
      {
        ID: 2,
        PARENT_ID: 1,
        OPERATION: "TABLE ACCESS",
        OPTIONS: "FULL",
        OBJECT_OWNER: "APP",
        OBJECT_NAME: "CUSTOMERS",
        CARDINALITY: 10,
        FILTER_PREDICATES: "TRUNC(created_at) = DATE '2026-01-01'",
        ...(actual
          ? {
              LAST_STARTS: 1,
              LAST_OUTPUT_ROWS: 200000,
              LAST_ELAPSED_TIME: 1000000,
              LAST_CR_BUFFER_GETS: 9999999,
            }
          : {}),
      },
    ],
  };
}

test("Oracle profile retains engine-specific identity and excludes secrets", () => {
  assert.deepEqual(
    profileSchema.parse(JSON.parse(JSON.stringify(profile))),
    profile,
  );
  assert.throws(() => profileSchema.parse({ ...profile, password: "secret" }));
  assert.equal(
    sameConnection(profile, {
      ...profile,
      type: "oracle",
      currentSchema: "APP",
    }),
    false,
  );
  assert.match(
    oracleConfig(profile, "secret").connectString!,
    /tcp:\/\/127\.0\.0\.1:55441\/FREEPDB1/,
  );
  assert.throws(() =>
    oracleConfig({ ...profile, database: "FREEPDB1?ssl_server_dn_match=no" }),
  );
  assert.equal(
    oracleConfig({ ...profile, ssl: "verify" }).sslServerDNMatch,
    true,
  );
});

test("Oracle boundaries respect q quotes, identifiers, hints, comments and slash", () => {
  const queries = splitOracle(
    `SELECT /*+ FULL(t) */ q'[a;b]' x, q'{x;y}' y, nq'<a;b>' z FROM "semi;table" t;\n/\nSELECT 4/2 FROM dual; -- tail`,
  );
  assert.equal(queries.length, 2);
  assert.match(queries[0], /FULL\(t\)/);
  assert.equal(validateOracle(queries[1]), "SELECT 4/2 FROM dual");
  assert.equal(
    splitOracle(
      "SELECT 1 FROM dual; SELECT 2 FROM dual;",
      "SELECT 3 FROM dual;",
    ).length,
    1,
  );
  assert.throws(() => splitOracle("SELECT 1 FROM dual", "   "));
  for (const bad of [
    "SELECT q'[unclosed' FROM dual",
    "SELECT 'unclosed",
    "SELECT 1 /*",
  ])
    assert.throws(() => splitOracle(bad));
  assert.equal(
    maskOracle("SELECT '😀;' FROM dual;").length,
    "SELECT '😀;' FROM dual;".length,
  );
});

test("Oracle skips whole PL/SQL and context-dependent tails without extracting inner SELECT", () => {
  const batch = prepareBatch(
    splitOracle(
      "SET SERVEROUTPUT ON\nCREATE TABLE t(id NUMBER);\nBEGIN\nINSERT INTO t VALUES(1); SELECT 1 INTO x FROM dual; END;\n/\nSELECT 1 FROM dual;",
    ),
    "oracle",
  );
  assert.deepEqual(
    batch.items.map((item) => item.status),
    ["skipped", "skipped", "skipped", "pending"],
  );
  const context = prepareBatch(
    splitOracle(
      "SELECT 1 FROM dual; ALTER SESSION SET CURRENT_SCHEMA = other; SELECT * FROM t;",
    ),
    "oracle",
  );
  assert.deepEqual(
    context.items.map((item) => item.status),
    ["pending", "skipped"],
  );
  const incompleteBlock = prepareBatch(
    splitOracle("BEGIN NULL; END; SELECT 1 FROM dual;"),
    "oracle",
  );
  assert.equal(incompleteBlock.items.length, 1);
  assert.equal(incompleteBlock.items[0].status, "skipped");
});

test("Oracle validates SELECT/INSERT forms and rejects unsupported execution contexts", () => {
  for (const sql of [
    "SELECT 1 FROM dual;",
    "WITH x AS (SELECT 1 id FROM dual) SELECT * FROM x",
    "INSERT INTO t(id) VALUES(1)",
    "INSERT INTO t SELECT 1 FROM dual",
    "INSERT INTO t WITH x AS (SELECT 1 FROM dual) SELECT * FROM x",
    "SELECT level FROM dual CONNECT BY level <= 5",
    "SELECT /*+ FULL(t) */ * FROM t",
  ])
    assert.ok(validateOracle(sql));
  for (const sql of [
    "SELECT 1 FROM dual; DELETE FROM t",
    "SELECT * INTO t FROM dual",
    "SELECT * FROM t FOR UPDATE",
    "SELECT :id FROM dual",
    "BEGIN SELECT 1 FROM dual; END;",
    "WITH FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; SELECT f() FROM dual",
    "INSERT ALL INTO t VALUES(1) SELECT 1 FROM dual",
    "INSERT INTO t VALUES(1) RETURNING id INTO :id",
  ])
    assert.throws(() => validateOracle(sql));
  assert.throws(() =>
    splitOracle(Array(21).fill("SELECT 1 FROM dual;").join("\n")),
  );
  const connector = databaseConnector("oracle");
  assert.equal(
    connector.prepareExecution(
      adapter.parse({ ...native(), query: "INSERT INTO t VALUES(1)" }),
    ).kind,
    "INSERT",
  );
});

test("Oracle adapter preserves hierarchy, absent metrics, unknown operators and microseconds", () => {
  const plan = adapter.parse(native(true));
  assert.equal(plan.database.engine, "oracle");
  assert.equal(plan.nodes[1].actuals?.totalTimeMs, 1234);
  assert.equal(plan.nodes[1].actuals?.rowsScope, "total");
  assert.equal(plan.nodes[1].estimates?.rowWidth, 100);
  assert.deepEqual(
    plan.edges.map((e) => [e.source, e.target]),
    [
      ["0", "1"],
      ["1", "2"],
    ],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(validate(JSON.parse(JSON.stringify(plan))))),
    JSON.parse(JSON.stringify(plan)),
  );
  const other = native();
  other.rows[2].OPERATION = "FUTURE OPERATOR";
  other.rows[2].unknown = "retained";
  const parsed = adapter.parse(other);
  assert.equal(parsed.nodes[2].category, "OTHER");
  assert.equal(parsed.nodes[2].properties.unknown, "retained");
  assert.equal(parsed.nodes[2].actuals, undefined);
});

test("Oracle malformed graphs and invalid runtime counters fail closed", () => {
  for (const mutate of [
    (v: OracleEnvelope) => {
      v.rows[2].ID = 1;
    },
    (v: OracleEnvelope) => {
      v.rows[2].PARENT_ID = 999;
    },
    (v: OracleEnvelope) => {
      v.rows[2].COST = -1;
    },
    (v: OracleEnvelope) => {
      v.rows[0].PARENT_ID = 2;
    },
    (v: OracleEnvelope) => {
      v.planKind = "actual";
    },
  ]) {
    const value = native();
    mutate(value);
    assert.throws(() => adapter.parse(value));
  }
});

test("Oracle estimated and measured analysis use real evidence and explain unavailable capabilities", () => {
  const estimated = analyzePlan(adapter.parse(native()));
  assert.ok(estimated.findings.some((f) => f.basis === "estimated"));
  assert.ok(
    estimated.findings.some(
      (f) => f.ruleId === "estimate.predicate-expression",
    ),
  );
  const plan = adapter.parse(native(true)),
    actual = analyzePlan(plan);
  assert.ok(
    actual.findings.some(
      (f) =>
        f.ruleId === "cardinality.discrepancy" || /discrepancy/.test(f.title),
    ),
  );
  assert.ok(actual.findings.some((f) => /Disk-backed/.test(f.title)));
  assert.ok(
    actual.findings.every((f) =>
      f.nodeIds.every((id) => plan.nodes.some((n) => n.id === id)),
    ),
  );
  const facts = oracleFacts(plan, plan.nodes[2]);
  assert.equal(facts.examinedRows, undefined);
  assert.equal(facts.availability.filtering.available, false);
  assert.equal(facts.availability.missingIndexes.available, false);
  assert.ok(
    actual.ruleCoverage.some((c) =>
      c.reasons.some((reason) => reason.includes("buffer gets")),
    ),
  );
  plan.nodes[0].properties.DBTUNA_ADAPTIVE = 1;
  assert.equal(
    oracleFacts(plan, plan.nodes[2]).availability.cardinality.available,
    false,
  );
  plan.nodes[0].properties.DBTUNA_ADAPTIVE = 0;
  plan.nodes[0].category = "PARALLEL";
  assert.equal(
    oracleFacts(plan, plan.nodes[2]).availability.repeated.available,
    false,
  );
});

const textPlan = `Plan hash value: 123\n---------------------------------------------------\n| Id | Operation          | Name | Rows | Cost (%CPU)|\n---------------------------------------------------\n| 0  | SELECT STATEMENT   |      | 100K |  100 (0) |\n| 1  |  TABLE ACCESS FULL | T    | 100K |  100 (0) |\n---------------------------------------------------\nPredicate Information:\n  1 - filter(TRUNC("CREATED_AT")=DATE '2026-01-01')`;
test("Oracle native JSON, canonical JSON and DBMS_XPLAN text import independently", () => {
  const registry = new AdapterRegistry([adapter]);
  assert.equal(registry.parse(textPlan).nodes[1].estimates?.rows, 100000);
  assert.equal(
    registry.parse(JSON.stringify(native())).database.engine,
    "oracle",
  );
  assert.equal(
    registry.parse(JSON.stringify(adapter.parse(native()))).database.engine,
    "oracle",
  );
  assert.match(
    String(registry.parse(textPlan).nodes[1].properties.FILTER_PREDICATES),
    /TRUNC/,
  );
  assert.equal(parseOracleText(textPlan).planKind, "estimated");
  const embedded = adapter.parse({
    ...native(),
    query: "SELECT '| Id | Operation |' FROM dual",
  });
  assert.equal(registry.parse(JSON.stringify(embedded)).query, embedded.query);
  assert.equal(
    registry.parseStatements(JSON.stringify(embedded))[0].query,
    embedded.query,
  );
  assert.throws(() => parseOracleText("not a plan"));
});

test("Oracle AI includes dialect and chosen query without connection metadata", () => {
  const plan = adapter.parse(native());
  plan.application.connectionLabel = "PRIVATE_HOST";
  plan.nodes[0].properties.OTHER_XML = "PRIVATE_PEEKED_BINDS";
  const payload = advicePayload({ plan, nodeId: "2", context: "" });
  assert.match(payload, /oracle/);
  assert.match(payload, /19.0/);
  assert.ok(!payload.includes("PRIVATE_HOST"));
  assert.ok(!payload.includes("PRIVATE_PEEKED_BINDS"));
});

function fake(
  options: {
    failCollection?: boolean;
    failCommit?: boolean;
    ambiguous?: boolean;
    missingCounters?: boolean;
    privilegeDenied?: boolean;
    onFetch?: () => void;
    onCommit?: () => void;
    values?: unknown[][];
    onCollection?: () => void;
  } = {},
) {
  const calls: string[] = [];
  let fetch = 0;
  const connection = {
    oracleServerVersionString: "19.0",
    currentSchema: "",
    callTimeout: 0,
    execute: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("WHERE 1 = 0")) {
        if (options.privilegeDenied)
          throw Object.assign(Error("secret SQL"), { errorNum: 942 });
        return { rows: [] };
      }
      if (sql.startsWith("EXPLAIN PLAN")) return {};
      if (sql.includes("FROM PLAN_TABLE")) return { rows: native().rows };
      if (sql.startsWith("ALTER SESSION")) return {};
      if (sql.startsWith("/* DBTuna_"))
        return sql.includes("INSERT")
          ? { rowsAffected: 1 }
          : {
              resultSet: {
                getRows: async () => {
                  calls.push("fetch");
                  options.onFetch?.();
                  return fetch++ === 0 ? options.values || [[1], [2]] : [];
                },
                close: async () => {
                  calls.push("resultSet.close");
                },
              },
            };
      if (sql.includes("FROM V$SQL WHERE"))
        return {
          rows: options.ambiguous
            ? [
                { SQL_ID: "a", CHILD_NUMBER: 0 },
                { SQL_ID: "a", CHILD_NUMBER: 1 },
              ]
            : [{ SQL_ID: "a", CHILD_NUMBER: 0 }],
        };
      if (sql.includes("FROM V$SQL_PLAN_STATISTICS_ALL")) {
        options.onCollection?.();
        if (options.failCollection) throw Error("secret SQL");
        return { rows: native(!options.missingCounters).rows };
      }
      return { rows: [] };
    },
    commit: async () => {
      calls.push("commit");
      options.onCommit?.();
      if (options.failCommit) throw Error("network lost");
    },
    rollback: async () => {
      calls.push("rollback");
    },
    close: async () => {
      calls.push("close");
    },
    break: async () => {
      calls.push("break");
    },
  } as unknown as OracleConnection;
  const driver: OracleDriver = { getConnection: async () => connection };
  return { driver, calls, connection };
}

test("Oracle estimated collection only compiles and rolls diagnostic writes back", async () => {
  const { driver, calls } = fake();
  const result = await collectOraclePlan(
    profile,
    "secret",
    "INSERT INTO t VALUES(1)",
    false,
    undefined,
    driver,
  );
  assert.equal(adapter.parse(result.raw).application.planKind, "estimated");
  assert.ok(calls.some((c) => c.startsWith("EXPLAIN PLAN")));
  assert.ok(!calls.some((c) => c.startsWith("/* DBTuna_") || c === "commit"));
  assert.deepEqual(calls.slice(-2), ["rollback", "close"]);
});

test("Oracle actual SELECT drains result set before exact-cursor collection", async () => {
  const { driver, calls } = fake();
  const result = await collectOraclePlan(
    profile,
    "secret",
    "SELECT * FROM t",
    true,
    undefined,
    driver,
  );
  assert.equal(adapter.parse(result.raw).application.planKind, "actual");
  assert.equal(calls.filter((c) => c === "fetch").length, 2);
  assert.ok(
    calls.indexOf("resultSet.close") <
      calls.findIndex((c) => c.includes("SUBSTR(SQL_TEXT")),
  );
  assert.ok(
    calls.some((c) =>
      c.includes("SQL_ID = :sqlId AND CHILD_NUMBER = :childNumber"),
    ),
  );
  assert.ok(!calls.includes("commit"));
});

test("Oracle INSERT commits only after verified runtime plan collection", async () => {
  const { driver, calls } = fake();
  await collectOraclePlan(
    profile,
    "secret",
    "INSERT INTO t VALUES(1)",
    true,
    undefined,
    driver,
  );
  assert.equal(calls.filter((c) => c === "commit").length, 1);
  assert.ok(
    calls.findIndex((c) => c.includes("WHERE SQL_ID =")) <
      calls.indexOf("commit"),
  );
});

test("Oracle ambiguity, missing statistics and collection failure never commit or retry INSERT", async () => {
  for (const options of [
    { ambiguous: true },
    { missingCounters: true },
    { failCollection: true },
  ]) {
    const { driver, calls } = fake(options);
    await assert.rejects(
      collectOraclePlan(
        profile,
        "secret",
        "INSERT INTO t VALUES(1)",
        true,
        undefined,
        driver,
      ),
      /not committed/,
    );
    assert.ok(!calls.includes("commit"));
    assert.equal(calls.filter((c) => c.startsWith("/* DBTuna_")).length, 1);
    assert.deepEqual(calls.slice(-2), ["rollback", "close"]);
  }
});

test("Oracle preflight permissions fail before business execution without leaking SQL", async () => {
  const { driver, calls } = fake({ privilegeDenied: true });
  await assert.rejects(
    collectOraclePlan(
      profile,
      "secret",
      "INSERT INTO t VALUES(1)",
      true,
      undefined,
      driver,
    ),
    (error) =>
      error instanceof Error &&
      /privileges/.test(error.message) &&
      !/secret SQL/.test(error.message),
  );
  assert.ok(!calls.some((c) => c.startsWith("/* DBTuna_")));
});

test("Oracle commit errors report uncertainty and never retry", async () => {
  const { driver, calls } = fake({ failCommit: true });
  await assert.rejects(
    collectOraclePlan(
      profile,
      "secret",
      "INSERT INTO t VALUES(1)",
      true,
      undefined,
      driver,
    ),
    /commit outcome is uncertain/,
  );
  assert.equal(calls.filter((c) => c === "commit").length, 1);
});

test("Oracle cancellation breaks fetching, closes resources and prevents commit", async () => {
  const controller = new AbortController(),
    { driver, calls } = fake({ onFetch: () => controller.abort() });
  await assert.rejects(
    collectOraclePlan(
      profile,
      "secret",
      "SELECT * FROM t",
      true,
      controller.signal,
      driver,
    ),
    /cancelled/,
  );
  assert.ok(calls.includes("break"));
  assert.ok(calls.includes("resultSet.close"));
  assert.ok(calls.includes("close"));
  assert.ok(!calls.includes("commit"));
});

test("Oracle cancellation after commit explicitly reports a persisted INSERT", async () => {
  const controller = new AbortController(),
    { driver } = fake({ onCommit: () => controller.abort() });
  await assert.rejects(
    collectOraclePlan(
      profile,
      "secret",
      "INSERT INTO t VALUES(1)",
      true,
      controller.signal,
      driver,
    ),
    /was committed/,
  );
});

test("Oracle overall deadline covers multiple short round trips", async () => {
  const { driver, calls } = fake();
  await assert.rejects(
    withOracle(
      profile,
      "secret",
      async (_connection, check) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        check();
      },
      undefined,
      5,
      driver,
    ),
    /overall deadline/,
  );
  assert.ok(calls.includes("break"));
  assert.ok(calls.includes("close"));
});

test("Oracle drains scalar rows without reading LOB contents and waits for LOB closure", async () => {
  let closed = false;
  const lob = new Readable({
    read() {
      throw Error("LOB contents must not be materialized");
    },
    destroy(_error, callback) {
      setTimeout(() => {
        closed = true;
        callback(null);
      }, 5);
    },
  });
  const { driver } = fake({
    values: [[lob]],
    onCollection: () => assert.ok(closed),
  });
  await collectOraclePlan(
    profile,
    "secret",
    "SELECT lob_column FROM t",
    true,
    undefined,
    driver,
  );
  assert.ok(closed);
});

test("Oracle program units and nested result cursors never become eligible statements", () => {
  for (const prefix of [
    "WITH FUNCTION f RETURN NUMBER IS BEGIN",
    "CREATE OR REPLACE EDITIONABLE FUNCTION f RETURN NUMBER IS BEGIN",
    "CREATE OR REPLACE PACKAGE BODY pkg AS PROCEDURE p IS BEGIN",
    "<<outer_label>> BEGIN",
  ]) {
    const parts = splitOracle(
      prefix + " NULL; SELECT 1 INTO x FROM dual; END;\n/\nSELECT 2 FROM dual;",
    );
    const batch = prepareBatch(parts, "oracle");
    assert.deepEqual(
      batch.items.map((item) => item.status),
      [prefix.startsWith("WITH") ? "error" : "skipped", "pending"],
    );
  }
  assert.throws(
    () => validateOracle("SELECT CURSOR(SELECT * FROM t) FROM dual"),
    /nested cursor/,
  );
});
