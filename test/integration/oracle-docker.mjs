import { randomBytes } from "node:crypto";
import { withDockerDatabase } from "../helpers/dockerDatabase.mjs";
import { runNode } from "../helpers/run.mjs";

const password = "T" + randomBytes(12).toString("hex") + "a1";
await withDockerDatabase(
  {
    engine: "oracle",
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
  async (container) => {
    container.command(
      ["exec", "--interactive", container.name, "sqlplus", "-s", "/ as sysdba"],
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
    console.log(
      "Oracle ready; running the isolated live suite with test-only grants.",
    );
    runNode(["--import", "tsx", "--test", "test/integration/oracle.test.ts"], {
      DBTUNA_ORACLE_TEST: "1",
      DBTUNA_ORACLE_TEST_PASSWORD: password,
      DBTUNA_ORACLE_TEST_LIMITED_PASSWORD: password,
    });
  },
);
