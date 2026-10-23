import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import oracledb from "oracledb";
import { profileSchema } from "../../src/extension/connection/profile";
import {
  oracleConfig,
  collectOraclePlan,
} from "../../src/extension/connection/oracleClient";
import { OracleAdapter } from "../../packages/adapter-oracle/src/oracleAdapter";

// Deliberately fixed to a disposable localhost instance. Never read saved VS
// Code connections or accept a configurable production host in automated tests.
test(
  "isolated Oracle estimated and actual SELECT/INSERT",
  { skip: process.env.DBTUNA_ORACLE_TEST !== "1", timeout: 180000 },
  async () => {
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
    const adapter = new OracleAdapter();
    const count = async () =>
      Number(
        (await connection.execute<unknown[]>(`SELECT COUNT(*) FROM ${table}`))
          .rows![0][0],
      );
    try {
      await connection.execute(
        `CREATE TABLE ${table} (id NUMBER, name VARCHAR2(100))`,
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
    } finally {
      await connection.execute(`DROP TABLE ${table} PURGE`).catch(() => {});
      await connection.close();
    }
  },
);
