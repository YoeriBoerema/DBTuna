import { SqlServerAdapter } from "../../../packages/adapter-sqlserver/src/sqlServerAdapter";
import {
  collectSqlServerPlan,
  collectActualSqlServerPlan,
} from "../connection/sqlServerClient";
import { splitTsqlBatch, validateTsql } from "../sql/sqlServerSelection";
import { prepareTsqlExplain } from "../sql/sqlServerExplain";
import { prepareSqlServerExecution } from "../sql/executionPreparation";
import type { DatabaseConnector } from "./databaseConnector";
const adapter = new SqlServerAdapter();
export const sqlServerConnector: DatabaseConnector = {
  type: "sqlserver",
  split: splitTsqlBatch,
  classify: (sql) =>
    prepareTsqlExplain(sql).map((candidate) => {
      if (candidate.skippedReason)
        return {
          sql: candidate.sql,
          status: "skipped",
          reason: candidate.skippedReason,
        };
      try {
        validateTsql(candidate.sql);
        return { sql: candidate.sql, status: "supported" };
      } catch (error) {
        return {
          sql: candidate.sql,
          status: "invalid",
          reason: error instanceof Error ? error.message : "Invalid SQL.",
        };
      }
    }),
  validate: validateTsql,
  collectEstimated: collectSqlServerPlan,
  collectActual: collectActualSqlServerPlan,
  parse: (raw) => adapter.parseStatements(raw),
  prepareExecution: prepareSqlServerExecution,
  selectActual(raw, estimated, kind) {
    const statements = (Array.isArray(raw) ? raw : [raw]).flatMap((document) =>
      adapter.parseStatements(document),
    );
    const normalize = (text?: string) =>
      (text || "").trim().replace(/;\s*$/, "");
    const matches = statements.filter(
      (plan) => normalize(plan.query) === normalize(estimated.query),
    );
    const candidates = matches.length
      ? matches
      : statements.filter((plan) => plan.application.statementType === kind);
    if (candidates.length !== 1)
      throw Error(
        "The query ran, but its actual plan could not be identified uniquely among returned statement/trigger plans.",
      );
    return candidates[0];
  },
};
