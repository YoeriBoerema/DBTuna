import { SQL_LIMITS } from "../../../packages/plan-core/src/limits";
import { MAX_BATCH_STATEMENTS } from "../../../packages/plan-core/src/batch";
// Find candidate boundaries lexically; the PostgreSQL AST validator checks every
// candidate before EXPLAIN. Unclosed/ambiguous quoting fails the entire batch.
export function splitSqlBatch(text: string, selection?: string): string[] {
  const sql = selection === undefined ? text : selection;
  if (new TextEncoder().encode(sql).byteLength > SQL_LIMITS.bytes)
    throw Error("Selected SQL exceeds 1 MiB.");
  const result: string[] = [];
  let start = 0,
    i = 0,
    hasSql = false;
  const finish = (end: number) => {
    if (hasSql) {
      result.push(sql.slice(start, end).trim());
      if (result.length > MAX_BATCH_STATEMENTS)
        throw Error(
          `Explain at most ${MAX_BATCH_STATEMENTS} statements at a time.`,
        );
    }
    start = end;
    hasSql = false;
  };
  while (i < sql.length) {
    if (/\s/.test(sql[i])) {
      i++;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      i = end < 0 ? sql.length : end;
      continue;
    }
    if (sql.startsWith("/*", i)) {
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
      if (depth) throw Error("Cannot split batch: unclosed SQL comment.");
      continue;
    }
    const quote = sql[i];
    if (quote === "'" || quote === '"') {
      hasSql = true;
      const escaped =
        quote === "'" &&
        i > 0 &&
        /[eE]/.test(sql[i - 1]) &&
        (i < 2 || !/[\w$]/.test(sql[i - 2]));
      i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === "\\" && quote === "'") {
          if (!escaped)
            throw Error(
              "Ambiguous backslash quoting. Use an explicit E string or standard doubled quotes.",
            );
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) throw Error("Cannot split batch: unclosed SQL quote.");
      continue;
    }
    if (sql[i] === "$" && (i === 0 || !/[\w$]/.test(sql[i - 1]))) {
      const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (tag) {
        hasSql = true;
        const end = sql.indexOf(tag, i + tag.length);
        if (end < 0) throw Error("Cannot split batch: unclosed dollar quote.");
        i = end + tag.length;
        continue;
      }
    }
    if (sql[i] === ";") {
      i++;
      finish(i);
      continue;
    }
    hasSql = true;
    i++;
  }
  finish(sql.length);
  if (!result.length)
    throw Error("Select SQL statements or open a file containing SQL.");
  return result;
}
