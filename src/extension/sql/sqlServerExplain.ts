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
  if (/\b(BEGIN|IF|WHILE|TRY|CATCH|PROCEDURE|PROC|FUNCTION|TRIGGER)\b/i.test(masked))
    return [{ sql: batch, skippedReason: "Control flow or module definitions cannot be safely separated. Select an independent query instead." }];

  const result: ExplainCandidate[] = [];
  const declarations: string[] = [];
  let blocked = false;
  let start = 0;
  // Masking preserves offsets and hides semicolons in strings/comments/identifiers.
  // NOCOUNT also commonly appears on its own line without a semicolon.
  const boundaries = [...masked.matchAll(/;|\bSET\s+NOCOUNT\s+(?:ON|OFF)[ \t]*(?=\r?$)/gim)]
    .map((match) => match.index! + match[0].length);
  boundaries.push(batch.length);
  for (const end of boundaries) {
    const sql = batch.slice(start, end).trim();
    start = end;
    const tokens = maskTsql(sql).replace(/;\s*$/, "").trim();
    if (!tokens) continue;
    if (/^SET\s+NOCOUNT\s+(ON|OFF)$/i.test(tokens)) {
      result.push({ sql, skippedReason: "SET NOCOUNT is omitted from estimated explanation." });
      continue;
    }
    if (blocked) {
      result.push({ sql, skippedReason: "Earlier session or variable setup is unsupported. Select this query separately or start a new GO batch." });
      continue;
    }
    if (/^(SET|USE|EXEC|EXECUTE|:|\$\()/i.test(tokens)) {
      blocked = true;
      result.push({ sql, skippedReason: "Unsupported session, variable or dynamic setup; subsequent statements in this GO batch are skipped to avoid misleading plans." });
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
      result.push({ sql, skippedReason: /^CREATE\s+TABLE\b/i.test(tokens)
        ? "CREATE TABLE is not executed during Explain. Queries that need this table may fail if it does not already exist."
        : error instanceof Error ? error.message : "Unsupported statement." });
    }
  }
  if (!result.length && declarations.length)
    result.push({ sql: declarations.join("\n"), skippedReason: "Declarations contain no query to explain." });
  return result;
}
