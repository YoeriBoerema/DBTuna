import { maskTsql, validateTsql } from "./sqlServerSelection";

export type ExplainCandidate = { sql: string; skippedReason?: string };

// Keep already-supported variable batches intact: SQL Server resolves shared context.
// Tolerant recovery is deliberately conservative around control flow and modules.
export function prepareTsqlExplain(batch: string): ExplainCandidate[] {
  try {
    validateTsql(batch);
    if (/\bDECLARE\b/i.test(maskTsql(batch))) return [{ sql: batch }];
  } catch {
    // Classify before collecting; rejected text is never sent to the server.
  }
  const masked = maskTsql(batch);
  const unsupported = unsupportedBatchReason(masked);
  if (unsupported) return [{ sql: batch, skippedReason: unsupported }];
  const result: ExplainCandidate[] = [];
  const declarations: string[] = [];
  let blocked = false;
  for (const { sql, tokens } of splitStatements(batch, masked)) {
    if (/^SET\s+NOCOUNT\s+(ON|OFF)$/i.test(tokens)) {
      result.push({
        sql,
        skippedReason: "SET NOCOUNT is omitted from estimated explanation.",
      });
      continue;
    }
    if (blocked) {
      result.push({
        sql,
        skippedReason:
          "Earlier session or variable setup is unsupported. Select this query separately or start a new GO batch.",
      });
      continue;
    }
    if (/^(SET|USE|EXEC|EXECUTE|:|\$\()/i.test(tokens)) {
      blocked = true;
      result.push({
        sql,
        skippedReason:
          "Unsupported session, variable or dynamic setup; subsequent statements in this GO batch are skipped to avoid misleading plans.",
      });
      continue;
    }
    if (/^DECLARE\b/i.test(tokens)) {
      // Reuse only context the existing strict validator accepts.
      try {
        validateTsql(sql + "\nSELECT 1;");
        declarations.push(sql);
      } catch {
        blocked = true;
        result.push({ sql, skippedReason: "Unsupported declaration context." });
      }
      continue;
    }
    const candidate = [...declarations, sql].join("\n");
    try {
      validateTsql(candidate);
      result.push({ sql: candidate });
    } catch (error) {
      result.push({
        sql,
        skippedReason: /^CREATE\s+TABLE\b/i.test(tokens)
          ? "CREATE TABLE is not executed during Explain. Queries that need this table may fail if it does not already exist."
          : error instanceof Error
            ? error.message
            : "Unsupported statement.",
      });
    }
  }
  if (!result.length && declarations.length)
    result.push({
      sql: declarations.join("\n"),
      skippedReason: "Declarations contain no query to explain.",
    });
  return result;
}

function unsupportedBatchReason(masked: string): string | undefined {
  if (
    /\b(BEGIN|IF|WHILE|TRY|CATCH|PROCEDURE|PROC|FUNCTION|TRIGGER)\b/i.test(
      masked,
    )
  )
    return "Control flow or module definitions cannot be safely separated. Select an independent query instead.";
}
function splitStatements(
  batch: string,
  masked: string,
): { sql: string; tokens: string }[] {
  // Masked offsets preserve quoted semicolons and nested comments. NOCOUNT may
  // appear alone on a line without the usual statement terminator.
  const boundaries = [
    ...masked.matchAll(/;|\bSET\s+NOCOUNT\s+(?:ON|OFF)[ \t]*(?=\r?$)/gim),
  ].map((match) => match.index! + match[0].length);
  boundaries.push(batch.length);
  let start = 0;
  const statements = [];
  for (const end of boundaries) {
    const sql = batch.slice(start, end).trim();
    const tokens = masked.slice(start, end).replace(/;\s*$/, "").trim();
    start = end;
    if (tokens) statements.push({ sql, tokens });
  }
  return statements;
}
