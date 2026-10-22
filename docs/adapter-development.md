# Add a database adapter or connector

[Documentation](README.md) · [Architecture](architecture.md) · [Security](security.md)

There are two extension points: an engine-independent native parser for offline plans, and a host-only connector for live database behavior. Keep database drivers and VS Code access outside parser packages.

## Native plan adapter

Implement [QueryPlanAdapter](../packages/adapter-sdk/src/adapter.ts) with an id, display name, narrow canParse discriminator and parse method returning a validated QueryPlan. Implement parseStatements when a native document can contain independent statement plans. Register it with AdapterRegistry in the extension entry point.

Preserve child order, unknown operators, native attributes and optional metrics. Unknown operators map to OTHER rather than disappearing. Use node properties and plan metadata for native information; use typed application fields for DBTuna-owned presentation data. Never infer milliseconds from cost or turn a missing metric into zero.

Test malformed input, size/depth/operator limits, unknown fields, absent metrics and single/multiple statement documents. Imported data must never authorize SQL execution.

## Live connector

Implement [DatabaseConnector](../src/extension/connectors/databaseConnector.ts) and register it in the [connector registry](../src/extension/connectors/registry.ts). Its responsibilities are:

| Method | Responsibility |
| --- | --- |
| split | Preserve exact selection and identify dialect-safe compilation units |
| validate | Reject unsupported or ambiguous SQL before collection |
| collectEstimated | Obtain native estimates without using the actual-run path |
| collectActual | Obtain actual plans for a separately confirmed execution |
| parse | Normalize native output into individual statement plans |
| prepareExecution | Scope one supported statement and needed safe setup |
| selectActual | Identify the chosen actual statement among returned plans |

Add the engine's profile variant and connection prompts/test behavior. Keep secrets in SecretStorage. Preserve bounded, dedicated sessions and explicit cancellation/cleanup. Confirmation, workspace trust, original-connection binding, duplicate prevention and no-retry policy belong in ExecutionManager, not the connector or UI.

Source-batch declaration context goes directly into host-side execution bindings. Do not serialize credentials or setup SQL in canonical plans. Keep presentation database-independent; add normalized semantics when necessary rather than teaching components to inspect arbitrary native attributes.

## Existing normalization rules

PostgreSQL uses per-loop Actual Rows and timing, with explicit loops. SQL Server uses total rows/executions across threads, summed CPU and maximum thread elapsed time. SQL Server estimated total cost is subtree-scoped. Preserve these distinctions when adding another engine.

SQL Server parses the whole XML document once, enforces document-wide limits and normalizes statement trees directly. Scoped native XML can be serialized for export metadata without reparsing. Numeric references decode exactly once, including when literal SQL resembles an entity.

## Verification

Start with synthetic/native fixtures, pure validation and session-protocol tests. Add browser coverage for normalized presentation. Run `npm run verify` before packaging. Live integration must target a disposable, isolated instance with test-only credentials; never use saved user profiles or production connections.

Document authentication, supported syntax, execution semantics and metric scopes in a new engine guide. Report unrun live checks explicitly instead of presenting fixtures as server compatibility evidence.
