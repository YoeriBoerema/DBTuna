import { UserFacingError } from "../../../packages/plan-core/src/errors";
import { DATABASE_TIMEOUTS } from "../../../packages/plan-core/src/limits";
import { Client, ClientConfig } from "pg";
import { validateSql } from "../sql/statementSelection";
import type { Profile } from "./profile";
import { databaseError } from "./databaseErrors";
import { protectPostgresResponses } from "./postgresBudget";
import { bounded } from "../../../packages/plan-core/src/schema";
export async function withClient<T>(
  config: ClientConfig,
  action: (c: Client) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs: number = DATABASE_TIMEOUTS.postgresEstimateClientMs,
): Promise<T> {
  const client = new Client({
    ...config,
    connectionTimeoutMillis: DATABASE_TIMEOUTS.connectMs,
    query_timeout: timeoutMs,
  });
  protectPostgresResponses(client);
  let fail!: (error: Error) => void;
  const failed = new Promise<never>((_resolve, reject) => {
    fail = reject;
  });
  void failed.catch(() => {});
  // pg emits fatal socket failures on the client as well as rejecting queries.
  // Observe idle failures too; an unhandled error event would kill the host.
  client.on("error", fail);
  const abort = () => {
    void client.end().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new UserFacingError("Cancelled.");
    await Promise.race([client.connect(), failed]);
    return await Promise.race([action(client), failed]);
  } catch (error) {
    if (signal?.aborted)
      throw new UserFacingError("Database operation cancelled.");
    throw databaseError(error);
  } finally {
    signal?.removeEventListener("abort", abort);
    await client.end().catch(() => {});
    client.removeListener("error", fail);
  }
}
export function clientConfig(
  p: Profile,
  password: string | undefined,
): ClientConfig {
  return {
    host: p.host,
    port: p.port,
    database: p.database,
    user: p.user,
    password,
    ssl: p.ssl === "verify" ? { rejectUnauthorized: true } : false,
    application_name: "DBTuna",
  };
}
export async function collectPlan(
  config: ClientConfig,
  sql: string,
  signal?: AbortSignal,
) {
  const query = validateSql(sql);
  return withClient(
    config,
    async (client) => {
      await client.query("BEGIN READ ONLY");
      try {
        await client.query(
          `SET LOCAL statement_timeout = '${DATABASE_TIMEOUTS.estimateStatementMs}ms'`,
        );
        const version = await client.query("SHOW server_version");
        const result = await client.query(
          "EXPLAIN (FORMAT JSON, VERBOSE TRUE, COSTS TRUE) " + query,
        );
        return {
          raw: bounded(result.rows[0]["QUERY PLAN"]),
          version: String(version.rows[0].server_version),
        };
      } finally {
        await client.query("ROLLBACK").catch(() => {});
      }
    },
    signal,
  );
}

export async function collectActualPlan(
  config: ClientConfig,
  sql: string,
  signal?: AbortSignal,
) {
  const query = validateSql(sql);
  return withClient(
    config,
    async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          `SET LOCAL statement_timeout = '${DATABASE_TIMEOUTS.actualStatementMs}ms'`,
        );
        await client.query(
          `SET LOCAL lock_timeout = '${DATABASE_TIMEOUTS.lockMs}ms'`,
        );
        const version = await client.query("SHOW server_version");
        const result = await client.query(
          "EXPLAIN (ANALYZE TRUE, BUFFERS TRUE, FORMAT JSON, VERBOSE TRUE, COSTS TRUE) " +
            query,
        );
        const raw = bounded(result.rows[0]["QUERY PLAN"]);
        if (signal?.aborted)
          throw new UserFacingError("Execution cancelled before commit.");
        await client.query("COMMIT");
        return {
          raw,
          version: String(version.rows[0].server_version),
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      }
    },
    signal,
    DATABASE_TIMEOUTS.postgresActualClientMs,
  );
}
