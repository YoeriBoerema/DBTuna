import { z } from "zod";
import type { MetadataEntry } from "./catalog";
const name = z.string().min(1).max(1024);
const relationship = z.object({
  table: name,
  column: name,
  targetSchema: name,
  targetTable: name,
  targetColumn: name,
});
export interface DiagramTable {
  id: string;
  schema: string;
  name: string;
  columns: string[];
  external: boolean;
}
export interface DiagramRelationship {
  id: string;
  name: string;
  source: string;
  target: string;
  columns: string[];
  columnPairs: { source: string; target: string }[];
}
export interface RelationshipGraph {
  schema: string;
  tables: DiagramTable[];
  relationships: DiagramRelationship[];
}
export function relationshipGraph(
  schema: string,
  tables: MetadataEntry[],
  rows: MetadataEntry[],
): RelationshipGraph {
  const nodes = new Map<string, DiagramTable>();
  const edges = new Map<string, DiagramRelationship>();
  const table = (owner: string, name: string) => {
    const id = JSON.stringify([owner, name]);
    if (!nodes.has(id))
      nodes.set(id, {
        id,
        schema: owner,
        name,
        columns: [],
        external: owner !== schema,
      });
    return nodes.get(id)!;
  };
  for (const entry of tables) table(schema, entry.name);
  for (const entry of rows) {
    const row = relationship.parse(JSON.parse(entry.detail));
    // Only diagram relationships belonging to tables in the visible schema listing.
    const source = nodes.get(JSON.stringify([schema, row.table]));
    if (!source || source.external) continue;
    const target = table(row.targetSchema, row.targetTable);
    if (!source.columns.includes(row.column)) source.columns.push(row.column);
    if (!target.columns.includes(row.targetColumn))
      target.columns.push(row.targetColumn);
    const id = JSON.stringify([source.id, entry.name]);
    if (!edges.has(id))
      edges.set(id, {
        id,
        name: entry.name,
        source: source.id,
        target: target.id,
        columns: [],
        columnPairs: [],
      });
    edges.get(id)!.columns.push(`${row.column} → ${row.targetColumn}`);
    edges
      .get(id)!
      .columnPairs.push({ source: row.column, target: row.targetColumn });
  }
  if (nodes.size > 2000)
    throw Error(
      "The database diagram exceeds 2,000 tables, including referenced tables.",
    );
  return {
    schema,
    tables: [...nodes.values()],
    relationships: [...edges.values()],
  };
}

export interface SchemaRelationships {
  schema: string;
  tables: MetadataEntry[];
  rows: MetadataEntry[];
}
export function databaseRelationshipGraph(
  database: string,
  schemas: SchemaRelationships[],
): RelationshipGraph {
  const visible = new Set(
    schemas.flatMap((s) =>
      s.tables.map((t) => JSON.stringify([s.schema, t.name])),
    ),
  );
  const tables = new Map<string, DiagramTable>();
  const relationships: DiagramRelationship[] = [];
  let mappings = 0;
  for (const schema of schemas) {
    mappings += schema.rows.length;
    if (mappings > 10000)
      throw Error(
        "The database diagram exceeds 10,000 foreign-key column mappings.",
      );
    const graph = relationshipGraph(schema.schema, schema.tables, schema.rows);
    for (const table of graph.tables) {
      const existing = tables.get(table.id);
      if (existing)
        existing.columns = [
          ...new Set([...existing.columns, ...table.columns]),
        ];
      else tables.set(table.id, { ...table, external: !visible.has(table.id) });
    }
    if (tables.size > 2000)
      throw Error(
        "The database diagram exceeds 2,000 tables, including referenced tables.",
      );
    relationships.push(...graph.relationships);
  }
  return { schema: database, tables: [...tables.values()], relationships };
}
