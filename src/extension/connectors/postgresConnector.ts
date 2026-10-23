import { PostgresAdapter } from "../../../packages/adapter-postgres/src/postgresAdapter";
import {
  clientConfig,
  collectPlan,
  collectActualPlan,
} from "../connection/postgresClient";
import { preparePostgresExplain } from "../sql/postgresExplain";
import { splitSqlBatch } from "../sql/batchSelection";
import { validateSql } from "../sql/statementSelection";
import { preparePostgresExecution } from "../sql/executionPreparation";
import type { DatabaseConnector } from "./databaseConnector";
const adapter = new PostgresAdapter();
export const postgresConnector: DatabaseConnector = {
  type: "postgresql",
  split: splitSqlBatch,
  classify: (sql) => [preparePostgresExplain(sql)],
  validate: validateSql,
  collectEstimated: (profile, password, sql, signal) =>
    collectPlan(clientConfig(profile, password), sql, signal),
  collectActual: (profile, password, sql, signal) =>
    collectActualPlan(clientConfig(profile, password), sql, signal),
  parse: (raw) => [adapter.parse(raw)],
  prepareExecution: preparePostgresExecution,
  selectActual: (raw) => adapter.parse(raw),
};
