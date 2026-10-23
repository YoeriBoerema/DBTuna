import type { MetadataKind } from "./catalog";
const pgTable = `n.nspname=$1 AND t.relname=$2`;
const pgKey = (type: string) =>
  `SELECT c.conname, pg_get_constraintdef(c.oid, true) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE ${pgTable} AND c.contype='${type}' ORDER BY c.conname LIMIT 2001`;

export const postgresCatalog: Record<MetadataKind, string> = {
  relationships: `SELECT c.conname, json_build_object('table',t.relname,'column',a.attname,'targetSchema',rn.nspname,'targetTable',rt.relname,'targetColumn',ra.attname)::text FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class rt ON rt.oid=c.confrelid JOIN pg_namespace rn ON rn.oid=rt.relnamespace CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY AS k(src,dst,pos) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.src JOIN pg_attribute ra ON ra.attrelid=rt.oid AND ra.attnum=k.dst WHERE c.contype='f' AND n.nspname=$1 AND (pg_has_role(t.relowner,'USAGE') OR has_table_privilege(t.oid,'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER') OR has_any_column_privilege(t.oid,'SELECT,INSERT,UPDATE,REFERENCES')) ORDER BY t.relname,c.conname,k.pos LIMIT 2001`,
  schemas: `SELECT n.nspname, '' FROM pg_namespace n WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' AND has_schema_privilege(n.oid,'USAGE') ORDER BY 1 LIMIT 2001`,
  tables: `SELECT t.relname, '' FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relkind='r' AND NOT t.relispartition AND (pg_has_role(t.relowner,'USAGE') OR has_table_privilege(t.oid,'SELECT,INSERT,UPDATE,DELETE,REFERENCES,TRIGGER') OR has_any_column_privilege(t.oid,'SELECT,INSERT,UPDATE,REFERENCES')) ORDER BY 1 LIMIT 2001`,
  columns: `SELECT a.attname, format_type(a.atttypid,a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' NULL' END || CASE WHEN a.attidentity<>'' THEN ' IDENTITY' ELSE '' END || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin,d.adrelid),'') FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum WHERE ${pgTable} AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum LIMIT 2001`,
  primaryKeys: pgKey("p"),
  foreignKeys: pgKey("f"),
  uniqueKeys: pgKey("u"),
  indexes: `SELECT i.relname, pg_get_indexdef(i.oid) FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class i ON i.oid=x.indexrelid WHERE ${pgTable} ORDER BY i.relname LIMIT 2001`,
};
