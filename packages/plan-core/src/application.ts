// Upgrade older DBTuna JSON without losing unknown native attributes. Runtime
// authorization still comes exclusively from the host's live execution bindings.
export function normalizePlanApplication(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const plan = input as Record<string, unknown>;
  const native = plan.metadata;
  if (!native || typeof native !== "object" || Array.isArray(native))
    return input;
  const metadata = { ...native } as Record<string, unknown>;
  const application: Record<string, unknown> = {};
  for (const key of [
    "connectionLabel",
    "executionAvailable",
    "executionUnavailableReason",
    "statementIndex",
    "statementType",
    "planKind",
    "clientElapsedMs",
  ]) {
    if (metadata[key] !== undefined) application[key] = metadata[key];
    delete metadata[key];
  }
  // Legacy exports included setup SQL. Never carry this into a normalized plan.
  delete metadata.batchSql;
  if (
    plan.application !== undefined &&
    (!plan.application ||
      typeof plan.application !== "object" ||
      Array.isArray(plan.application))
  )
    return { ...plan, metadata }; // Let the schema reject malformed application data.
  return {
    ...plan,
    metadata,
    application: {
      ...application,
      ...(plan.application && typeof plan.application === "object"
        ? plan.application
        : {}),
    },
  };
}
