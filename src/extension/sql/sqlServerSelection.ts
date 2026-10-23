import {
  PLAN_LIMITS,
  SQL_LIMITS,
} from "../../../packages/plan-core/src/limits";
// Mask literals, identifiers and nested comments before inspecting control tokens.
export function maskTsql(sql: string): string {
  let result = "",
    i = 0;
  while (i < sql.length) {
    const start = i;
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
    } else if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (sql.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw Error("Unclosed T-SQL comment.");
    } else if (["'", '"', "["].includes(sql[i])) {
      const close = sql[i] === "[" ? "]" : sql[i];
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] === close) {
          if (sql[i] === close) i++;
          else {
            closed = true;
            break;
          }
        }
      }
      if (!closed) throw Error("Unclosed T-SQL quote or identifier.");
    } else {
      result += sql[i++];
      continue;
    }
    result += sql.slice(start, i).replace(/[^\r\n]/g, " ");
  }
  return result;
}
export function validateTsql(sql: string): string {
  if (new TextEncoder().encode(sql).length > SQL_LIMITS.bytes)
    throw Error("Selected SQL exceeds 1 MiB.");
  const tokens = maskTsql(sql);
  if (/:\w|\$\(/.test(tokens))
    throw Error("SQLCMD directives are not supported.");
  if (!/^\s*;*\s*(SELECT|WITH|INSERT|DECLARE)\b/i.test(tokens))
    throw Error("Use SELECT, INSERT, WITH, or DECLARE followed by a query.");
  // Never allow the submitted text to disable Showplan or invoke opaque code.
  if (
    /\b(SET|UPDATE|DELETE|EXEC|EXECUTE|CREATE|ALTER|DROP|TRUNCATE|USE|DBCC|BACKUP|RESTORE|RECONFIGURE|SHUTDOWN|REVERT|OPENQUERY|OPENROWSET|OPENDATASOURCE|BULK|GO)\b/i.test(
      tokens,
    )
  )
    throw Error(
      "This T-SQL batch contains unsupported control, DDL, or external-access statements. Explain query batches only; omit SET and GO repetition counts.",
    );
  if (!/\b(SELECT|INSERT)\b/i.test(tokens)) throw Error("No query to explain.");
  return sql;
}
export function splitTsqlBatch(text: string, selection?: string): string[] {
  const sql = selection ?? text;
  if (new TextEncoder().encode(sql).length > SQL_LIMITS.bytes)
    throw Error("Selected SQL exceeds 1 MiB.");
  const masked = maskTsql(sql);
  const result: string[] = [];
  let start = 0;
  const boundary = /^[ \t]*GO[ \t]*\r?$/gim;
  for (const match of masked.matchAll(boundary)) {
    const part = sql.slice(start, match.index).trim();
    if (maskTsql(part).replace(/;/g, "").trim()) result.push(part);
    start = match.index! + match[0].length;
  }
  const tail = sql.slice(start).trim();
  if (maskTsql(tail).replace(/;/g, "").trim()) result.push(tail);
  if (!result.length) throw Error("Select SQL queries or open a SQL file.");
  if (result.length > PLAN_LIMITS.statements)
    throw Error("Explain at most 20 T-SQL batches at a time.");
  return result;
}
