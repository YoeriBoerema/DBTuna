import { parse } from "pgsql-ast-parser";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import { validateSql } from "../sql/statementSelection";
import { validateTsql, maskTsql } from "../sql/sqlServerSelection";
export function executionQuery(plan: QueryPlan): {
  sql: string;
  kind: "SELECT" | "INSERT";
} {
  if (!plan.query?.trim()) throw Error("Run Explain on a live query first.");
  if (plan.database.engine === "postgresql") {
    const sql = validateSql(plan.query);
    let main: unknown = parse(sql)[0];
    while (
      main &&
      typeof main === "object" &&
      "type" in main &&
      main.type === "with"
    )
      main = (main as { in?: unknown }).in;
    const kind =
      main &&
      typeof main === "object" &&
      "type" in main &&
      main.type === "insert"
        ? "INSERT"
        : "SELECT";
    return { sql, kind };
  }
  if (plan.database.engine !== "sqlserver")
    throw Error(
      "Actual execution is supported for PostgreSQL and SQL Server only.",
    );
  const kind = plan.metadata.statementType;
  if (kind !== "SELECT" && kind !== "INSERT")
    throw Error("The actual-plan MVP supports one SELECT or INSERT statement.");
  const sql = validateTsql(plan.query),
    masked = maskTsql(sql);
  if (masked.split(";").filter((part) => part.trim()).length !== 1)
    throw Error("Run one statement at a time.");
  if (kind === "SELECT" && /\bINTO\b/i.test(masked))
    throw Error("SELECT INTO is not supported for actual execution.");
  const variables = [
    ...new Set(
      (masked.match(/(?<![@\w])@[A-Za-z_][A-Za-z_0-9]*/g) || []).map((name) =>
        name.toLowerCase(),
      ),
    ),
  ];
  if (!variables.length) return { sql, kind };
  const batch =
    typeof plan.metadata.batchSql === "string" ? plan.metadata.batchSql : "";
  const batchMask = maskTsql(batch);
  const declarations = new Map<string, string>();
  let start = 0;
  for (const match of batchMask.matchAll(/;/g)) {
    const part = batch.slice(start, match.index! + 1).trim();
    start = match.index! + 1;
    if (!/^\s*DECLARE\b/i.test(maskTsql(part))) break;
    // MVP: reuse only single-variable declarations with literal initializers, never earlier queries or function calls.
    const declaration = part.match(
      /^DECLARE\s+(@[A-Za-z_][A-Za-z_0-9]*)\s+[A-Za-z_][A-Za-z_0-9]*(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?\s*(?:=\s*(?:[-+]?\d+(?:\.\d+)?|N?'(?:[^']|'')*'|NULL))?\s*;$/i,
    );
    if (declaration) declarations.set(declaration[1].toLowerCase(), part);
  }
  const context = variables.map((name) => {
    const declaration = declarations.get(name.toLowerCase());
    if (!declaration)
      throw Error(
        "This statement needs unsupported variable setup. MVP supports leading, semicolon-terminated DECLARE statements with literal values only.",
      );
    return declaration;
  });
  return { sql: context.join("\n") + "\n" + sql, kind };
}
