export function postgresNative(
  properties?: Record<string, unknown>,
): { Plan: Record<string, unknown> }[];
export function sqlServerNative(options?: {
  operator?: string;
  estimate?: number;
  counters?: string;
  warnings?: string;
  statementWarnings?: string;
  body?: string;
}): string;
