// Browser-safe resource limits. Byte limits and character limits are distinct.
export const PLAN_LIMITS = {
  bytes: 5 * 1024 * 1024,
  objectDepth: 512,
  xmlDepth: 512,
  values: 150000,
  operators: 1000,
  edges: 1000,
  batchOperators: 5000,
  statements: 20,
  actualDocuments: 20,
} as const;
export const SQL_LIMITS = {
  bytes: 1024 * 1024,
  characters: 1024 * 1024,
} as const;
export const AI_LIMITS = {
  inputBytes: 512 * 1024,
  responseBytes: 2 * 1024 * 1024,
  queryCharacters: 512 * 1024,
  contextCharacters: 4000,
  outputTokens: 8192,
  requestMs: 90000,
  modelListMs: 15000,
  scoreReasonCharacters: 160,
  suggestionCharacters: 200,
  suggestions: 3,
} as const;
export const DATABASE_TIMEOUTS = {
  connectMs: 5000,
  estimateStatementMs: 10000,
  postgresEstimateClientMs: 12000,
  actualStatementMs: 30000,
  postgresActualClientMs: 35000,
  lockMs: 5000,
  cancelMs: 2000,
} as const;
