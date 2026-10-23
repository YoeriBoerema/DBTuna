import { randomBytes } from "node:crypto";
import { withDockerDatabase } from "../helpers/dockerDatabase.mjs";
import { runNode } from "../helpers/run.mjs";

const password = "T" + randomBytes(12).toString("hex") + "a1!";
const image =
  "mcr.microsoft.com/mssql/server:2022-latest@sha256:97b448857967be55e005424a660056fe6d51814435804dc07e8f79f028bab5fb";
let tool;
function sql(container, text) {
  return container.command(
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
}
await withDockerDatabase(
  {
    engine: "sqlserver",
    image,
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
          /* Waiting for SQL Server or trying the older tools path. */
        }
      }
      return false;
    },
  },
  async (container) => {
    sql(container, "CREATE DATABASE dbtuna_integration;");
    console.log(
      "SQL Server ready; running isolated estimated/actual plan tests.",
    );
    runNode(
      ["--import", "tsx", "--test", "test/integration/sqlserver.test.ts"],
      { DBTUNA_SQLSERVER_TEST: "1", DBTUNA_SQLSERVER_TEST_PASSWORD: password },
    );
  },
);
