import { randomBytes } from "node:crypto";
import { withDockerDatabase } from "./dockerDatabase.mjs";
import { runNode } from "./run.mjs";
export const databaseEngines = ["postgresql", "sqlserver", "oracle"];
export const databasePassword = () =>
  "T" + randomBytes(12).toString("hex") + "a1!";
export function databaseDefinition(engine, password) {
  if (engine === "postgresql")
    return {
      config: {
        engine,
        image:
          "postgres:18.4@sha256:a02db8cac496f15b094798a38254f14d6e00741f709360e5e00bb6668ea31636",
        port: 55439,
        containerPort: 5432,
        environment: {
          POSTGRES_USER: "dbtuna",
          POSTGRES_DB: "dbtuna_integration",
          POSTGRES_PASSWORD: password,
        },
        ready: (container) => {
          try {
            container.command([
              "exec",
              container.name,
              "pg_isready",
              "-h",
              "127.0.0.1",
              "-U",
              "dbtuna",
              "-d",
              "dbtuna_integration",
            ]);
            return true;
          } catch {
            return false;
          }
        },
      },
      prepare: async () => {},
      testFile: "test/integration/postgres.test.ts",
      testEnvironment: {
        DBTUNA_POSTGRES_TEST: "1",
        DBTUNA_POSTGRES_TEST_PASSWORD: password,
      },
      connection: {
        host: "127.0.0.1",
        port: 55439,
        database: "dbtuna_integration",
        user: "dbtuna",
      },
    };
  if (engine === "sqlserver") {
    let tool;
    const sql = (container, text) =>
      container.command(
        [
          "exec",
          "--env",
          "SQLCMDPASSWORD",
          container.name,
          tool,
          "-S",
          "localhost",
          "-U",
          "sa",
          "-C",
          "-l",
          "2",
          "-b",
          "-Q",
          text,
        ],
        { env: { ...process.env, SQLCMDPASSWORD: password } },
      );
    return {
      config: {
        engine,
        image:
          "mcr.microsoft.com/mssql/server:2022-latest@sha256:97b448857967be55e005424a660056fe6d51814435804dc07e8f79f028bab5fb",
        port: 55440,
        containerPort: 1433,
        environment: {
          ACCEPT_EULA: "Y",
          MSSQL_PID: "Developer",
          MSSQL_SA_PASSWORD: password,
          MSSQL_MEMORY_LIMIT_MB: "2048",
        },
        ready: (container) => {
          for (const candidate of [
            "/opt/mssql-tools18/bin/sqlcmd",
            "/opt/mssql-tools/bin/sqlcmd",
          ]) {
            tool = candidate;
            try {
              sql(container, "SELECT 1");
              return true;
            } catch {
              /* Wait for readiness or try the alternate tools path. */
            }
          }
          return false;
        },
      },
      prepare: async (container) => {
        sql(container, "CREATE DATABASE dbtuna_integration;");
      },
      testFile: "test/integration/sqlserver.test.ts",
      testEnvironment: {
        DBTUNA_SQLSERVER_TEST: "1",
        DBTUNA_SQLSERVER_TEST_PASSWORD: password,
      },
      connection: {
        host: "127.0.0.1",
        port: 55440,
        database: "dbtuna_integration",
        user: "sa",
        trustServerCertificate: true,
      },
    };
  }
  if (engine === "oracle")
    return {
      config: {
        engine,
        image:
          "gvenzl/oracle-free:23-slim-faststart@sha256:f5ff19033860d662c821cb04eb10483fa94f14f78eae252d054291ea07028093",
        port: 55441,
        containerPort: 1521,
        environment: {
          ORACLE_PASSWORD: password,
          APP_USER: "dbtuna_integration",
          APP_USER_PASSWORD: password,
        },
        runArgs: [
          "--shm-size",
          "1g",
          "--health-cmd",
          "healthcheck.sh",
          "--health-interval",
          "5s",
          "--health-timeout",
          "5s",
          "--health-start-period",
          "60s",
          "--health-retries",
          "24",
        ],
        ready: (_container, state) => state.Health?.Status === "healthy",
      },
      prepare: async (container) => {
        container.command(
          [
            "exec",
            "--interactive",
            container.name,
            "sqlplus",
            "-s",
            "/ as sysdba",
          ],
          {
            input: `WHENEVER SQLERROR EXIT FAILURE
ALTER SESSION SET CONTAINER = FREEPDB1;
GRANT ALTER SESSION, CREATE TABLE TO dbtuna_integration;
ALTER USER dbtuna_integration QUOTA 50M ON users;
CREATE USER dbtuna_no_stats IDENTIFIED BY "${password}";
GRANT CREATE SESSION TO dbtuna_no_stats;
GRANT SELECT ON sys.v_$sql TO dbtuna_integration;
GRANT SELECT ON sys.v_$sql_plan_statistics_all TO dbtuna_integration;
EXIT;
`,
          },
        );
      },
      testFile: "test/integration/oracle.test.ts",
      testEnvironment: {
        DBTUNA_ORACLE_TEST: "1",
        DBTUNA_ORACLE_TEST_PASSWORD: password,
        DBTUNA_ORACLE_TEST_LIMITED_PASSWORD: password,
      },
      connection: {
        host: "127.0.0.1",
        port: 55441,
        service: "FREEPDB1",
        user: "dbtuna_integration",
      },
    };
  throw Error("Unknown test database engine.");
}
export async function runDisposableDatabase(engine) {
  const definition = databaseDefinition(engine, databasePassword());
  await withDockerDatabase(definition.config, async (container) => {
    await definition.prepare(container);
    console.log(`${engine} ready; running isolated integration tests.`);
    runNode(
      ["--import", "tsx", "--test", definition.testFile],
      definition.testEnvironment,
    );
  });
}
