import { randomBytes } from "node:crypto";
import { withDockerDatabase } from "../helpers/dockerDatabase.mjs";
import { runNode } from "../helpers/run.mjs";

const password = "T" + randomBytes(12).toString("hex") + "a1";
await withDockerDatabase(
  {
    engine: "postgresql",
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
        // TCP readiness excludes the temporary socket-only initialization server.
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
  async () => {
    console.log(
      "PostgreSQL ready; running isolated estimated/actual plan tests.",
    );
    runNode(
      ["--import", "tsx", "--test", "test/integration/postgres.test.ts"],
      { DBTUNA_POSTGRES_TEST: "1", DBTUNA_POSTGRES_TEST_PASSWORD: password },
    );
  },
);
