import type { MetadataKind } from "./catalog";
const oraTable = `c.owner=:p1 AND c.table_name=:p2`;
const oraKey = (type: string) =>
  `SELECT c.constraint_name, LISTAGG(cc.column_name, ', ') WITHIN GROUP (ORDER BY cc.position) || ' [' || c.status || ']' FROM all_constraints c JOIN all_cons_columns cc ON cc.owner=c.owner AND cc.constraint_name=c.constraint_name WHERE ${oraTable} AND c.constraint_type='${type}' GROUP BY c.constraint_name,c.status ORDER BY c.constraint_name FETCH FIRST 2001 ROWS ONLY`;

export const oracleCatalog: Record<MetadataKind, string> = {
  schemas: `SELECT DISTINCT owner, '' FROM all_tables WHERE nested='NO' AND secondary='N' AND partitioned='NO' ORDER BY owner FETCH FIRST 2001 ROWS ONLY`,
  tables: `SELECT table_name, '' FROM all_tables WHERE owner=:p1 AND nested='NO' AND secondary='N' AND partitioned='NO' AND temporary='N' AND iot_name IS NULL ORDER BY table_name FETCH FIRST 2001 ROWS ONLY`,
  columns: `SELECT column_name, data_type || CASE WHEN data_type IN ('VARCHAR2','CHAR','NVARCHAR2','NCHAR') THEN '(' || char_length || CASE WHEN char_used='C' THEN ' CHAR' ELSE ' BYTE' END || ')' WHEN data_type='NUMBER' AND data_precision IS NOT NULL THEN '(' || data_precision || ',' || NVL(data_scale,0) || ')' ELSE '' END || CASE WHEN nullable='N' THEN ' NOT NULL' ELSE ' NULL' END || CASE WHEN identity_column='YES' THEN ' IDENTITY' ELSE '' END FROM all_tab_columns WHERE owner=:p1 AND table_name=:p2 ORDER BY column_id FETCH FIRST 2001 ROWS ONLY`,
  primaryKeys: oraKey("P"),
  uniqueKeys: oraKey("U"),
  foreignKeys: `SELECT c.constraint_name, LISTAGG(cc.column_name || ' -> ' || r.owner || '.' || r.table_name || '.' || rc.column_name, ', ') WITHIN GROUP (ORDER BY cc.position) || ' ON DELETE ' || c.delete_rule || ' [' || c.status || ']' FROM all_constraints c JOIN all_cons_columns cc ON cc.owner=c.owner AND cc.constraint_name=c.constraint_name LEFT JOIN all_constraints r ON r.owner=c.r_owner AND r.constraint_name=c.r_constraint_name LEFT JOIN all_cons_columns rc ON rc.owner=r.owner AND rc.constraint_name=r.constraint_name AND rc.position=cc.position WHERE ${oraTable} AND c.constraint_type='R' GROUP BY c.constraint_name,c.delete_rule,c.status ORDER BY c.constraint_name FETCH FIRST 2001 ROWS ONLY`,
  indexes: `SELECT i.owner || '.' || i.index_name, i.index_type || ' ' || i.uniqueness || ' (' || LISTAGG(c.column_name || ' ' || c.descend, ', ') WITHIN GROUP (ORDER BY c.column_position) || ') [' || i.status || ']' FROM all_indexes i JOIN all_ind_columns c ON c.index_owner=i.owner AND c.index_name=i.index_name WHERE i.table_owner=:p1 AND i.table_name=:p2 GROUP BY i.owner,i.index_name,i.index_type,i.uniqueness,i.status ORDER BY i.index_name FETCH FIRST 2001 ROWS ONLY`,
};
