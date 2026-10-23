import { OracleAdapter } from "../../../packages/adapter-oracle/src/oracleAdapter";
import { collectOraclePlan } from "../connection/oracleClient";
import {
  classifyOracle,
  oracleKind,
  splitOracle,
  validateOracle,
} from "../sql/oracleSelection";
import type { DatabaseConnector } from "./databaseConnector";
const adapter = new OracleAdapter();
export const oracleConnector: DatabaseConnector = {
  type: "oracle",
  split: splitOracle,
  classify: classifyOracle,
  validate: validateOracle,
  collectEstimated: (profile, password, sql, signal) =>
    collectOraclePlan(profile, password, sql, false, signal),
  collectActual: (profile, password, sql, signal) =>
    collectOraclePlan(profile, password, sql, true, signal),
  parse: (raw) => [adapter.parse(raw)],
  prepareExecution: (plan) => {
    if (!plan.query?.trim())
      throw Error("Run Explain on a live Oracle query first.");
    const sql = validateOracle(plan.query);
    return { sql, kind: oracleKind(sql) };
  },
  selectActual: (raw) => adapter.parse(raw),
};
