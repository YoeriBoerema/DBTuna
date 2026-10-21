# Adding an adapter

Implement QueryPlanAdapter from adapter-sdk, with a narrow canParse discriminator and parse method returning a validated QueryPlan. Register it in AdapterRegistry in the extension entry point. Keep native mappings and traversal in the adapter package. Preserve unknown attributes in node properties and plan metadata.

Build a separate host-only connection collector and credential workflow if live access is required. Include fixture tests for optional metrics, unknown operators, native nesting and malformed input. The React graph requires no database-specific changes.

SQL Server adapter: `packages/adapter-sqlserver/src/sqlServerAdapter.ts` consumes Showplan XML and produces the same rooted-forest schema. IDs are scoped across statement roots. `estimates.totalCost` is cumulative subtree cost, marked with optional `costScope: "subtree"`; optional CPU/I/O estimates retain optimizer units. Native XML and non-RelOp attributes are retained. Unknown operators map to OTHER. Do not interpret missing runtime aggregates as zero.

Runtime normalization: PostgreSQL Actual Rows and timings are per loop. SQL Server RunTimeCountersPerThread rows and executions are totals across workers; rowsScope is "total". cpuTimeMs sums worker CPU and elapsedTimeMs is the maximum worker elapsed value, deliberately distinct from PostgreSQL totalTimeMs. Missing counters remain absent and all raw runtime attributes are retained.
