import { Connection, Request, type ConnectionConfiguration } from "tedious";
import type { Profile } from "./profile";
import { validateTsql } from "../sql/sqlServerSelection";
export function sqlServerConfig(
  p: Profile,
  password?: string,
): ConnectionConfiguration {
  return {
    server: p.host,
    authentication: {
      type: p.authentication === "ntlm" ? "ntlm" : "default",
      options: {
        userName: p.user,
        password: password ?? "",
        ...(p.domain ? { domain: p.domain } : {}),
      },
    },
    options: {
      database: p.database,
      port: p.port,
      encrypt: p.ssl !== "disable",
      trustServerCertificate: p.ssl === "trust",
      connectTimeout: 5000,
      requestTimeout: 10000,
      cancelTimeout: 2000,
      appName: "DBTuna",
    },
  };
}
export async function withSqlServer<T>(
  p: Profile,
  password: string | undefined,
  action: (
    query: (
      sql: string,
      options?: { plansOnly?: boolean },
    ) => Promise<unknown[][]>,
  ) => Promise<T>,
  signal?: AbortSignal,
  timeoutMs = 10000,
): Promise<T> {
  const config = sqlServerConfig(p, password);
  config.options = { ...config.options, requestTimeout: timeoutMs };
  const connection = new Connection(config);
  const abort = () => connection.close();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw Error("Cancelled.");
    await new Promise<void>((resolve, reject) => {
      connection.once("error", reject);
      connection.once("end", () =>
        reject(Error("SQL Server connection closed.")),
      );
      connection.connect((error) => (error ? reject(error) : resolve()));
    });
    const query = (sql: string, options?: { plansOnly?: boolean }) =>
      new Promise<unknown[][]>((resolve, reject) => {
        if (signal?.aborted) {
          reject(Error("Cancelled."));
          return;
        }
        const rows: unknown[][] = [];
        let bytes = 0;
        const end = () =>
          reject(Error("SQL Server connection closed or cancelled."));
        connection.once("end", end);
        const request = new Request(sql, (error) => {
          connection.removeListener("end", end);
          if (error) reject(error);
          else resolve(rows);
        });
        request.on("row", (columns) => {
          if (
            options?.plansOnly &&
            (columns.length !== 1 ||
              columns[0].metadata.colName !==
                "Microsoft SQL Server 2005 XML Showplan")
          )
            return;
          const values = columns.map(
            (c: { value: unknown }) => c.value as unknown,
          );
          bytes += Buffer.byteLength(JSON.stringify(values));
          if (bytes > 5 * 1024 * 1024) {
            reject(Error("Plan exceeds 5 MiB."));
            connection.close();
          } else rows.push(values);
        });
        // SHOWPLAN must be its own SQL batch; do not use parameterized RPC execution.
        connection.execSqlBatch(request);
      });
    return await action(query);
  } finally {
    signal?.removeEventListener("abort", abort);
    connection.close();
  }
}
export async function testSqlServer(p: Profile, password?: string) {
  return withSqlServer(p, password, async (query) => {
    await query("SELECT 1");
  });
}
export async function collectSqlServerPlan(
  p: Profile,
  password: string | undefined,
  sql: string,
  signal?: AbortSignal,
) {
  validateTsql(sql);
  return withSqlServer(
    p,
    password,
    async (query) => {
      return explainSqlServerSession(query, sql, signal);
    },
    signal,
  );
}
export async function explainSqlServerSession(
  query: (sql: string) => Promise<unknown[][]>,
  sql: string,
  signal?: AbortSignal,
) {
  validateTsql(sql);
  await query("SET SHOWPLAN_XML ON");
  try {
    const rows = await query(sql);
    const xml = rows
      .flat()
      .filter(
        (v): v is string => typeof v === "string" && v.includes("ShowPlanXML"),
      );
    if (xml.length !== 1)
      throw Error("Expected one Showplan XML document for this T-SQL batch.");
    return { raw: xml[0], version: undefined };
  } finally {
    if (!signal?.aborted) await query("SET SHOWPLAN_XML OFF").catch(() => {});
  }
}

export async function actualSqlServerSession(
  query: (
    sql: string,
    options?: { plansOnly?: boolean },
  ) => Promise<unknown[][]>,
  sql: string,
  signal?: AbortSignal,
) {
  validateTsql(sql);
  await query("SET STATISTICS XML ON");
  try {
    const rows = await query(sql, { plansOnly: true });
    const documents = rows
      .flat()
      .filter(
        (value): value is string =>
          typeof value === "string" && value.includes("ShowPlanXML"),
      );
    if (!documents.length || documents.length > 20)
      throw Error(
        "Query ran but no single actual plan was returned. Data may already have changed; do not retry blindly.",
      );
    return {
      raw: documents.length === 1 ? documents[0] : documents,
      version: undefined,
    };
  } finally {
    if (!signal?.aborted) await query("SET STATISTICS XML OFF").catch(() => {});
  }
}
export async function collectActualSqlServerPlan(
  p: Profile,
  password: string | undefined,
  sql: string,
  signal?: AbortSignal,
) {
  return withSqlServer(
    p,
    password,
    (query) => actualSqlServerSession(query, sql, signal),
    signal,
    30000,
  );
}
