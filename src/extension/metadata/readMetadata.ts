import oracledb from "oracledb";
import type { Profile } from "../connection/profile";
import { clientConfig, withClient } from "../connection/postgresClient";
import { withSqlServer } from "../connection/sqlServerClient";
import { withOracle } from "../connection/oracleClient";
import {
  catalogQuery,
  normalizeMetadata,
  sqlServerMetadataSql,
  type MetadataKind,
  type MetadataScope,
} from "./catalog";
export async function readMetadata(
  profile: Profile,
  password: string | undefined,
  kind: MetadataKind,
  scope: MetadataScope,
  signal: AbortSignal,
) {
  const query = catalogQuery(profile.type, kind, scope);
  if (profile.type === "postgresql")
    return withClient(
      clientConfig(profile, password),
      async (client) => {
        await client.query("BEGIN READ ONLY");
        try {
          await client.query("SET LOCAL statement_timeout = '15000ms'");
          const result = await client.query({
            text: query.sql,
            values: query.values,
            rowMode: "array",
          });
          return normalizeMetadata(result.rows);
        } finally {
          await client.query("ROLLBACK").catch(() => {});
        }
      },
      signal,
    );
  if (profile.type === "sqlserver")
    return withSqlServer(
      profile,
      password,
      async (execute) =>
        normalizeMetadata(await execute(sqlServerMetadataSql(query))),
      signal,
      15000,
    );
  return withOracle(
    profile,
    password,
    async (connection, check) => {
      const result = await connection.execute(query.sql, query.values, {
        outFormat: oracledb.OUT_FORMAT_ARRAY,
        maxRows: 2001,
      });
      check();
      return normalizeMetadata((result.rows || []) as unknown[][]);
    },
    signal,
    15000,
  );
}
