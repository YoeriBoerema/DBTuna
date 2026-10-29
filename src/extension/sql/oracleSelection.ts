import { UserFacingError } from "../../../packages/plan-core/src/errors";
import {
  PLAN_LIMITS,
  SQL_LIMITS,
} from "../../../packages/plan-core/src/limits";
import type { ClassifiedStatement } from "../connectors/databaseConnector";

// Keep offsets intact while hiding comments, identifiers and literals from the
// boundary/eligibility checks. Oracle alternative quotes may contain semicolons.
export function maskOracle(sql: string): string {
  const chars = sql.split("");
  const hide = (start: number, end: number) => {
    for (let j = start; j < end; j++)
      if (chars[j] !== "\n" && chars[j] !== "\r") chars[j] = " ";
  };
  for (let i = 0; i < sql.length;) {
    const start = i;
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      hide(start, i);
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      if (end < 0) throw new UserFacingError("Unclosed Oracle comment.");
      i = end + 2;
      hide(start, i);
    } else if (
      /^(?:n?q)'/i.test(sql.slice(i)) &&
      (i === 0 || !/[\w$#]/.test(sql[i - 1]))
    ) {
      const prefix = sql.slice(i).match(/^(?:n?q)'/i)![0];
      const open = sql[i + prefix.length];
      if (!open || /\s/.test(open))
        throw new UserFacingError("Invalid Oracle alternative quote.");
      const close =
        ({ "[": "]", "{": "}", "(": ")", "<": ">" } as Record<string, string>)[
          open
        ] || open;
      const end = sql.indexOf(close + "'", i + prefix.length + 1);
      if (end < 0)
        throw new UserFacingError("Unclosed Oracle alternative quote.");
      i = end + 2;
      hide(start, i);
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++];
      let closed = false;
      while (i < sql.length) {
        if (sql[i++] !== quote) continue;
        if (sql[i] === quote) {
          i++;
          continue;
        }
        closed = true;
        break;
      }
      if (!closed) throw new UserFacingError("Unclosed Oracle quote.");
      hide(start, i);
    } else i++;
  }
  return chars.join("");
}

export function splitOracle(text: string, selection?: string): string[] {
  const sql = selection === undefined ? text : selection;
  if (Buffer.byteLength(sql) > SQL_LIMITS.bytes)
    throw new UserFacingError("Selected SQL exceeds 1 MiB.");
  const mask = maskOracle(sql),
    parts: string[] = [];
  let start = 0;
  const finish = (end: number) => {
    if (mask.slice(start, end).replace(/[;/\s]/g, ""))
      parts.push(sql.slice(start, end).trim());
    start = end;
    if (parts.length > PLAN_LIMITS.statements)
      throw new UserFacingError("Explain at most 20 statements at a time.");
  };
  // PL/SQL is never eligible. Keep an entire block until its client slash, or
  // conservatively to EOF, rather than accidentally executing its inner SQL.
  let block = false,
    inspectedStart = -1;
  const context =
    /^\s*(?:ALTER\s+SESSION\b|SET\s+(?:TRANSACTION|ROLE|CONSTRAINTS)\b|CONNECT\b|DISCONNECT\b|@)/i;
  for (let i = 0; i < mask.length; i++) {
    if (start !== inspectedStart) {
      inspectedStart = start;
      const prefix = mask.slice(start).trimStart();
      // Subsequent queries cannot safely ignore a skipped session/schema change.
      if (context.test(prefix)) {
        finish(sql.length);
        break;
      }
      block =
        /^(?:(?:<<[^<>]*>>\s*)?(?:BEGIN|DECLARE)\b|WITH\s+(?:FUNCTION|PROCEDURE)\b|CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|JAVA)\b)/i.test(
          prefix,
        );
    }
    if (
      mask[i] === "/" &&
      mask
        .slice(
          mask.lastIndexOf("\n", i - 1) + 1,
          mask.indexOf("\n", i) < 0 ? mask.length : mask.indexOf("\n", i),
        )
        .trim() === "/"
    ) {
      finish(i);
      start = i + 1;
      block = false;
    } else if (!block && mask[i] === ";") finish(i + 1);
    else if (
      !block &&
      (mask[i] === "\n" || i === mask.length - 1) &&
      /^\s*(?:SET\b|SPOOL\b|PROMPT\b|REM\b|WHENEVER\b|VARIABLE\b|EXEC(?:UTE)?\b|CONNECT\b|DISCONNECT\b|@)/i.test(
        mask.slice(start, i + 1),
      )
    )
      finish(i + 1);
  }
  finish(sql.length);
  if (!parts.length)
    throw new UserFacingError(
      "Select SQL statements or open a file containing SQL.",
    );
  return parts;
}

export function oracleKind(sql: string): "SELECT" | "INSERT" {
  const mask = maskOracle(sql).trim();
  if (/^INSERT\b/i.test(mask)) return "INSERT";
  if (/^SELECT\b/i.test(mask)) return "SELECT";
  if (/^WITH\b/i.test(mask)) {
    // WITH functions/procedures contain executable PL/SQL and are excluded.
    if (/\b(?:FUNCTION|PROCEDURE)\b/i.test(mask))
      throw new UserFacingError("WITH PL/SQL declarations are unsupported.");
    let depth = 0;
    for (const token of mask.matchAll(/\(|\)|\b(?:SELECT|INSERT)\b/gi)) {
      if (token[0] === "(") depth++;
      else if (token[0] === ")") depth--;
      else if (depth === 0)
        return token[0].toUpperCase() as "SELECT" | "INSERT";
    }
  }
  throw new UserFacingError(
    "Oracle supports one SELECT, WITH ... SELECT, or INSERT statement.",
  );
}

export function validateOracle(sql: string): string {
  const parts = splitOracle(sql);
  if (parts.length !== 1)
    throw new UserFacingError("Run one Oracle statement at a time.");
  const query = parts[0].replace(/;\s*$/, "").trim(),
    mask = maskOracle(query);
  oracleKind(query);
  if (/\bCURSOR\s*\(/i.test(mask))
    throw new UserFacingError(
      "Oracle nested cursor result sets are unsupported; select ordinary columns.",
    );
  if (/^\s*INSERT\s+(?:ALL|FIRST)\b/i.test(mask))
    throw new UserFacingError("Oracle multi-table INSERT is unsupported.");
  if (/[;:]/.test(mask))
    throw new UserFacingError(
      "Oracle bind parameters and embedded statement terminators are unsupported; supply a complete statement with literal values.",
    );
  if (
    /\b(?:UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COMMIT|ROLLBACK|BEGIN|DECLARE|EXECUTE|RETURNING)\b/i.test(
      mask,
    ) ||
    /\bFOR\s+UPDATE\b|\bINTO\b/i.test(
      mask.replace(/^\s*INSERT\s+(?:ALL\s+|FIRST\s+)?INTO\b/i, "INSERT"),
    )
  )
    throw new UserFacingError(
      "Only a single Oracle SELECT or INSERT is supported; locking, PL/SQL, multi-table INSERT and RETURNING are excluded.",
    );
  let depth = 0;
  for (const c of mask) {
    if (c === "(") depth++;
    if (c === ")" && --depth < 0)
      throw new UserFacingError("Unbalanced Oracle parentheses.");
  }
  if (depth) throw new UserFacingError("Unbalanced Oracle parentheses.");
  return query;
}

export function classifyOracle(sql: string): ClassifiedStatement[] {
  const mask = maskOracle(sql).trim();
  if (!/^(?:SELECT|WITH|INSERT)\b/i.test(mask))
    return [
      {
        sql,
        status: "skipped",
        reason:
          "Oracle setup, DDL, PL/SQL and SQL*Plus commands are not executed by Explain.",
      },
    ];
  try {
    return [{ sql: validateOracle(sql), status: "supported" }];
  } catch (error) {
    return [{ sql, status: "invalid", reason: (error as Error).message }];
  }
}
