import { parse } from "pgsql-ast-parser";
import { validateSql } from "./statementSelection";

// Only classify successfully parsed statements. Malformed or unrecognized syntax
// still reaches the normal validator and appears as Failed rather than Skipped.
export function preparePostgresExplain(sql: string): {
  sql: string;
  skippedReason?: string;
} {
  let statements: ReturnType<typeof parse>;
  try {
    statements = parse(sql);
  } catch {
    return { sql };
  }
  if (statements.length !== 1) return { sql };
  try {
    validateSql(sql);
    return { sql };
  } catch (error) {
    const type = statements[0].type;
    let reason = error instanceof Error ? error.message : "Unsupported statement.";
    if (type.startsWith("create ") || type.startsWith("alter ") || type.startsWith("drop "))
      reason = "DDL is not executed during Explain. Queries depending on objects this statement would create or change may fail or use their existing definitions.";
    else if (type === "set")
      reason = "Session settings are not applied during Explain. Each query uses a separate connection with DBTuna's connection defaults; this includes schema lookup and planner settings.";
    else if (["begin", "commit", "rollback"].includes(type))
      reason = "Script transaction control is omitted. Each estimated query is collected independently in a read-only transaction.";
    return { sql, skippedReason: reason };
  }
}
