import type { DatabaseConnector } from "./databaseConnector";
import { postgresConnector } from "./postgresConnector";
import { sqlServerConnector } from "./sqlServerConnector";
import { oracleConnector } from "./oracleConnector";
const connectors: readonly DatabaseConnector[] = [
  postgresConnector,
  sqlServerConnector,
  oracleConnector,
];
export function databaseConnector(type: string): DatabaseConnector {
  const connector = connectors.find((connector) => connector.type === type);
  if (!connector) throw Error("Unsupported database type: " + type);
  return connector;
}
