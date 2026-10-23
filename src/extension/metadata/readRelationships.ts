import type { Profile } from "../connection/profile";
import { readMetadata } from "./readMetadata";
import {
  databaseRelationshipGraph,
  type SchemaRelationships,
} from "./relationshipGraph";
export async function readDatabaseRelationships(
  profile: Profile,
  password: string | undefined,
  signal: AbortSignal,
  load: typeof readMetadata = readMetadata,
) {
  const check = () => {
    if (signal.aborted) throw Error("Cancelled.");
  };
  check();
  const schemas = await load(profile, password, "schemas", {}, signal);
  const catalogs: SchemaRelationships[] = [];
  let tablesCount = 0,
    mappingsCount = 0;
  for (const entry of schemas) {
    check();
    const scope = { schema: entry.name };
    const tables = await load(profile, password, "tables", scope, signal);
    check();
    tablesCount += tables.length;
    if (tablesCount > 2000)
      throw Error("The database diagram exceeds 2,000 tables.");
    const rows = await load(profile, password, "relationships", scope, signal);
    check();
    mappingsCount += rows.length;
    if (mappingsCount > 10000)
      throw Error(
        "The database diagram exceeds 10,000 foreign-key column mappings.",
      );
    catalogs.push({ schema: entry.name, tables, rows });
  }
  check();
  return databaseRelationshipGraph(profile.database, catalogs);
}
