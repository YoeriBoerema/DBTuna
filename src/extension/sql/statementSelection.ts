import { parse } from "pgsql-ast-parser";

export function validateSql(sql: string) {
  if (!sql.trim())
    throw Error(
      "Select one complete SELECT, VALUES, INSERT, or WITH statement.",
    );
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(sql);
  } catch {
    throw Error(
      "Unsupported or incomplete PostgreSQL syntax. Select one complete SELECT, VALUES, INSERT, or WITH statement without surrounding log text; some PostgreSQL syntax is not supported by the parser.",
    );
  }
  return validatePostgresAst(sql, ast);
}
export function validatePostgresAst(
  sql: string,
  ast: ReturnType<typeof parse>,
) {
  if (ast.length !== 1) throw Error("Select exactly one complete statement.");
  // Only the main statement may insert. CTE bodies must remain read-oriented.
  let main: unknown = ast[0];
  while (
    main &&
    typeof main === "object" &&
    "type" in main &&
    main.type === "with"
  ) {
    main = (main as { in?: unknown }).in;
  }
  const check = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if (
      typeof o.type === "string" &&
      [
        "update",
        "delete",
        "create table",
        "create view",
        "drop table",
        "truncate table",
        "do",
        "copy",
        "select into",
      ].includes(o.type)
    )
      throw Error(
        "UPDATE, DELETE and other unsupported statement types cannot be explained.",
      );
    if (o.type === "insert" && o !== main)
      throw Error(
        "Data-modifying CTEs are unsupported. Only the main statement may INSERT.",
      );
    if ((o.into !== undefined && o.type !== "insert") || o.for !== undefined)
      throw Error("SELECT INTO and locking queries are unsupported.");
    for (const child of Object.values(o))
      if (Array.isArray(child)) child.forEach(check);
      else check(child);
  };
  if (
    !main ||
    typeof main !== "object" ||
    !("type" in main) ||
    !["select", "values", "union", "union all", "insert"].includes(
      String(main.type),
    )
  )
    throw Error(
      "Only SELECT, VALUES, INSERT, and WITH statements ending in SELECT or INSERT are supported.",
    );
  check(ast);
  return sql.trim().replace(/;\s*$/, "");
}
// An existing selection is authoritative, even when it contains only whitespace.
export function selectStatement(text: string, selection?: string) {
  return validateSql(selection === undefined ? text : selection);
}
