import type { DatabaseConnector } from "./databaseConnector";
import { postgresConnector } from "./postgresConnector";
import { sqlServerConnector } from "./sqlServerConnector";
const connectors: readonly DatabaseConnector[] = [
  postgresConnector,
  sqlServerConnector,
];
export function databaseConnector(type: string): DatabaseConnector {
  const connector = connectors.find((connector) => connector.type === type);
  if (!connector) throw Error("Unsupported database type: " + type);
  return connector;
}
