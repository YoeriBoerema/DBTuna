import { verifyMetadata } from "../helpers/metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import oracledb from "oracledb";
import { profileSchema } from "../../src/extension/connection/profile";
import {
  oracleConfig,
  collectOraclePlan,
  type OracleDriver,
} from "../../src/extension/connection/oracleClient";
import { OracleAdapter } from "../../packages/adapter-oracle/src/oracleAdapter";
import { databaseConnector } from "../../src/extension/connectors/registry";
import {
  prepareBatch,
  explainBatch,
} from "../../src/extension/services/batchExplain";
import { analyzePlan } from "../../packages/plan-analysis/src/analyze";

// Deliberately fixed to a disposable localhost instance. Never read saved VS
// Code connections or accept a configurable production host in automated tests.
test(
  "isolated Oracle estimated and actual SELECT/INSERT",
  { skip: process.env.DBTUNA_ORACLE_TEST !== "1", timeout: 180000 },
  async (t) => {
    const password = process.env.DBTUNA_ORACLE_TEST_PASSWORD;
    assert.ok(password, "Set the disposable Oracle test user's password.");
    const profile = profileSchema.parse({
      type: "oracle",
      id: "oracle-integration",
      name: "Disposable Oracle",
      host: "127.0.0.1",
      port: 55441,
      database: "FREEPDB1",
      user: "dbtuna_integration",
      ssl: "disable",
    });
    const connection = await oracledb.getConnection(
      oracleConfig(profile, password),
    );
    connection.callTimeout = 10000;
    const table = "DBTUNA_" + randomBytes(6).toString("hex").toUpperCase();
    await verifyMetadata(profile, password, (sql) => connection.execute(sql));
    const adapter = new OracleAdapter();
    const count = async () =>
      Number(
        (await connection.execute<unknown[]>(`SELECT COUNT(*) FROM ${table}`))
          .rows![0][0],
      );
    try {
      await connection.execute(
        `CREATE TABLE ${table} (id NUMBER PRIMARY KEY, name VARCHAR2(100))`,
      );
      const sql = `SELECT * FROM ${table} ORDER BY id`;
      const estimate = await collectOraclePlan(profile, password, sql, false);
      assert.equal(adapter.parse(estimate.raw).database.engine, "oracle");
      for (const insert of [
        `INSERT INTO ${table} VALUES (1, 'one')`,
        `INSERT INTO ${table} SELECT 2, 'two' FROM dual`,
        `INSERT INTO ${table} WITH x AS (SELECT 3 id FROM dual) SELECT id, 'three' FROM x`,
      ]) {
        const before = await count();
        await collectOraclePlan(profile, password, insert, false);
        assert.equal(await count(), before, "Explain executed INSERT");
        const actual = adapter.parse(
          (await collectOraclePlan(profile, password, insert, true)).raw,
        );
        assert.ok(actual.nodes.some((node) => node.actuals));
        assert.equal(
          await count(),
          before + 1,
          "Actual INSERT was not committed",
        );
      }
      const actual = adapter.parse(
        (await collectOraclePlan(profile, password, sql, true)).raw,
      );
      assert.ok(actual.nodes.some((node) => node.actuals?.rows === 3));
      // Identical concurrent SQL must collect statistics for separate tagged cursors.
      const concurrent = await Promise.all([
        collectOraclePlan(profile, password, sql, true),
        collectOraclePlan(profile, password, sql, true),
      ]);
      for (const result of concurrent)
        assert.ok(
          adapter
            .parse(result.raw)
            .nodes.some((node) => node.actuals?.rows === 3),
        );
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        collectOraclePlan(
          profile,
          password,
          `INSERT INTO ${table} VALUES(4, 'cancelled')`,
          true,
          controller.signal,
        ),
      );
      assert.equal(await count(), 3);
      await t.test(
        "large SELECT fully fetches multiple chunks, joins and Oracle quoting compile",
        async () => {
          await connection.execute(
            `INSERT INTO ${table} SELECT level + 10, 'bulk' FROM dual CONNECT BY level <= 2048`,
          );
          await connection.commit();
          const result = await collectOraclePlan(
            profile,
            password,
            `SELECT /*+ FULL(t) */ * FROM ${table} t ORDER BY id`,
            true,
          );
          const plan = adapter.parse(result.raw);
          assert.ok(plan.nodes.some((node) => node.actuals?.rows === 2051));
          assert.ok(plan.nodes.some((node) => /SORT/.test(node.nativeType)));
          assert.doesNotThrow(() => analyzePlan(plan));
          mkdirSync("work", { recursive: true });
          // Test-generated object names and data only; no connection/secret fields.
          writeFileSync(
            "work/oracle-live-select.json",
            JSON.stringify(result.raw, null, 2),
          );
          for (const query of [
            `SELECT a.id FROM ${table} a INNER JOIN ${table} b ON a.id=b.id WHERE a.id < 20`,
            "SELECT q'[one;two]' text_value FROM dual",
            `WITH x AS (SELECT id FROM ${table}) SELECT COUNT(*) FROM x`,
          ])
            assert.ok(
              adapter.parse(
                (await collectOraclePlan(profile, password, query, false)).raw,
              ).nodes.length,
            );
          console.log(
            `Verified live Oracle ${plan.database.version}; multi-chunk rows, sort, join, CTE and alternative quoting.`,
          );
        },
      );
      await t.test(
        "LOB results close without materializing contents",
        async () => {
          const plan = adapter.parse(
            (
              await collectOraclePlan(
                profile,
                password,
                "SELECT TO_CLOB(RPAD('x', 2000, 'x')) lob_value FROM dual",
                true,
              )
            ).raw,
          );
          assert.ok(plan.nodes.some((node) => node.actuals?.rows === 1));
        },
      );
      await t.test(
        "database errors do not commit or retry INSERT",
        async () => {
          const before = await count();
          await assert.rejects(
            collectOraclePlan(
              profile,
              password,
              `INSERT INTO ${table} VALUES(1, 'duplicate')`,
              true,
            ),
            /ORA-00001/,
          );
          assert.equal(await count(), before);
          assert.equal(
            Number(
              (
                await connection.execute<unknown[]>(
                  "SELECT COUNT(*) FROM PLAN_TABLE",
                )
              ).rows![0][0],
            ),
            0,
            "Estimate diagnostic rows were committed",
          );
        },
      );
      await t.test(
        "mixed batch skips setup and continues after a database compilation failure",
        async () => {
          const connector = databaseConnector("oracle");
          const batch = prepareBatch(
            connector.split(
              `SET SERVEROUTPUT ON\nCREATE TABLE unused(id NUMBER);\nSELECT * FROM ${table}; SELECT * FROM DBTUNA_TABLE_DOES_NOT_EXIST; SELECT 1 FROM dual;`,
            ),
            "oracle",
          );
          const result = await explainBatch(
            batch,
            async (query, signal) =>
              connector.parse(
                (
                  await connector.collectEstimated(
                    profile,
                    password,
                    query,
                    signal,
                  )
                ).raw,
              ),
            new AbortController().signal,
            () => {},
          );
          assert.deepEqual(
            result.items.map((item) => item.status),
            ["skipped", "skipped", "complete", "error", "complete"],
          );
        },
      );
      await t.test(
        "in-flight INSERT cancellation rolls back work and releases locks",
        async () => {
          const before = await count(),
            abort = new AbortController();
          let executionStarted = false,
            timer: ReturnType<typeof setTimeout> | undefined;
          const transport: OracleDriver = {
            getConnection: async (config) => {
              const client = await oracledb.getConnection(config);
              const execute = client.execute.bind(client);
              client.execute = ((
                ...args: Parameters<typeof client.execute>
              ) => {
                if (String(args[0]).startsWith("/* DBTuna_")) {
                  executionStarted = true;
                  timer = setTimeout(() => abort.abort(), 50);
                }
                return execute(...args);
              }) as typeof client.execute;
              return client;
            },
          };
          try {
            await assert.rejects(
              collectOraclePlan(
                profile,
                password,
                `INSERT INTO ${table} SELECT level + 100000, 'cancelled' FROM dual CONNECT BY level <= 10000000`,
                true,
                abort.signal,
                transport,
              ),
              /cancelled/,
            );
            assert.ok(executionStarted);
            assert.equal(await count(), before);
            // NOWAIT proves the cancelled session did not keep an INSERT lock.
            await connection.execute(
              `LOCK TABLE ${table} IN EXCLUSIVE MODE NOWAIT`,
            );
            await connection.rollback();
          } finally {
            if (timer) clearTimeout(timer);
          }
        },
      );
      const limitedPassword = process.env.DBTUNA_ORACLE_TEST_LIMITED_PASSWORD;
      if (limitedPassword)
        await t.test(
          "missing cursor privileges fail before INSERT while estimates still work",
          async () => {
            await connection.execute(
              `GRANT SELECT, INSERT ON ${table} TO dbtuna_no_stats`,
            );
            const limited = { ...profile, user: "dbtuna_no_stats" };
            const target = `dbtuna_integration.${table}`,
              before = await count();
            assert.ok(
              adapter.parse(
                (
                  await collectOraclePlan(
                    limited,
                    limitedPassword,
                    `SELECT * FROM ${target}`,
                    false,
                  )
                ).raw,
              ).nodes.length,
            );
            await assert.rejects(
              collectOraclePlan(
                limited,
                limitedPassword,
                `INSERT INTO ${target} VALUES(99999, 'denied')`,
                true,
              ),
              /privileges/,
            );
            assert.equal(await count(), before);
          },
        );
    } finally {
      await connection.execute(`DROP TABLE ${table} PURGE`).catch(() => {});
      await connection.close();
    }
  },
);
