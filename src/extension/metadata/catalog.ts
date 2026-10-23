import { postgresCatalog } from "./postgresCatalog";
import { sqlServerCatalog } from "./sqlServerCatalog";
import { oracleCatalog } from "./oracleCatalog";
import type { Profile } from "../connection/profile";
export type MetadataKind =
  | "schemas"
  | "tables"
  | "relationships"
  | "columns"
  | "primaryKeys"
  | "foreignKeys"
  | "uniqueKeys"
  | "indexes";
export interface MetadataScope {
  schema?: string;
  table?: string;
}
export interface MetadataEntry {
  name: string;
  detail: string;
}
export interface MetadataQuery {
  sql: string;
  values: string[];
}
// All SQL is owned by the connector; names are values, never executable identifiers.
export function catalogQuery(
  engine: Profile["type"],
  kind: MetadataKind,
  scope: MetadataScope,
): MetadataQuery {
  if (kind !== "schemas" && !scope.schema) throw Error("Schema is required.");
  if (
    kind !== "schemas" &&
    kind !== "tables" &&
    kind !== "relationships" &&
    !scope.table
  )
    throw Error("Table is required.");
  const values =
    kind === "schemas"
      ? []
      : kind === "tables" || kind === "relationships"
        ? [scope.schema!]
        : [scope.schema!, scope.table!];
  const sql = catalogs[engine][kind];
  return { sql, values };
}
const catalogs = {
  postgresql: postgresCatalog,
  sqlserver: sqlServerCatalog,
  oracle: oracleCatalog,
};

export function sqlServerMetadataSql(query: MetadataQuery): string {
  return query.sql.replace(
    /@p([12])\b/g,
    (_, position: string) =>
      "N'" + query.values[Number(position) - 1].replaceAll("'", "''") + "'",
  );
}
export class MetadataLimitError extends Error {}
export function normalizeMetadata(rows: unknown[][]): MetadataEntry[] {
  if (rows.length > 2000)
    throw new MetadataLimitError(
      "More than 2,000 objects in this folder. Narrow the database scope before browsing.",
    );
  return rows.map((row) => {
    if (typeof row[0] !== "string") throw Error("Invalid catalog object name.");
    return { name: row[0], detail: row[1] == null ? "" : String(row[1]) };
  });
}
