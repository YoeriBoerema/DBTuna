import { Client, ClientConfig } from "pg";
import { validateSql } from "../sql/statementSelection";
export interface Profile {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: "disable" | "verify";
}
export async function withClient<T>(
  config: ClientConfig,
  action: (c: Client) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const client = new Client({
    ...config,
    connectionTimeoutMillis: 5000,
    query_timeout: 12000,
  });
  const abort = () => {
    void client.end().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw Error("Cancelled.");
    await client.connect();
    return await action(client);
  } finally {
    signal?.removeEventListener("abort", abort);
    await client.end().catch(() => {});
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
        await client.query("SET LOCAL statement_timeout = '10000ms'");
        const version = await client.query("SHOW server_version");
        const result = await client.query(
          "EXPLAIN (FORMAT JSON, VERBOSE TRUE, COSTS TRUE) " + query,
        );
        return {
          raw: result.rows[0]["QUERY PLAN"] as unknown,
          version: String(version.rows[0].server_version),
        };
      } finally {
        await client.query("ROLLBACK").catch(() => {});
      }
    },
    signal,
  );
}
