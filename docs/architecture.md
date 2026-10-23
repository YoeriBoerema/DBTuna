# Architecture

[Documentation](README.md) · [Development](development.md) · [Adding a connector](adapter-development.md)

## Request flow

1. The active editor supplies exactly its selection, or its entire document when no selection exists.
2. ExplainCoordinator selects the database connector, splits/validates input and manages sequential batch progress and cancellation.
3. The connector collects a native plan and delegates normalization to the engine adapter.
4. The core validates a canonical QueryPlan and assigns query-section identity.
5. Typed messages deliver plan snapshots to the React webview, where ELK lays out the graph and React Flow renders it.

Estimated collection, confirmed actual execution and optional AI advice are separate workflows. Database drivers, secrets and external HTTP remain in the extension host.

## Module map

| Location | Responsibility |
| --- | --- |
| `src/extension/extension.ts` | Construct services, register commands and wire messages |
| `src/extension/services/explainCoordinator.ts` | Editor input, Explain progress and batch cancellation |
| `src/extension/services/batchExplain.ts` | Ordered query outcomes and per-statement expansion |
| `src/extension/services/planFiles.ts` | Sample loading, offline imports and estimated-plan/batch exports |
| `src/extension/services/executionManager.ts` | Live bindings, workspace trust, duplicate prevention and actual execution |
| `src/extension/connectors/` | Dialect splitting, validation, collection, preparation and actual-statement selection |
| `src/extension/connection/` | Driver sessions, profile repository and setup wizard |
| `src/extension/ai/` | Advice input, instructions, model/credential setup and bounded API transport |
| `packages/adapter-sdk/` | Native parser contract and registry |
| `packages/adapter-postgres/`, `packages/adapter-sqlserver/` | Engine-specific normalization |
| `packages/plan-analysis/` | Database fact extractors, applicability/coverage, pure individual rules and finding contracts |
| `scripts/` | Version-derived packaging, VSIX verification and generated build information |
| `webview/src/styles/` | Feature styles imported in explicit cascade order |
| `packages/plan-core/` | Canonical schemas, graph invariants, batches, advice contract and resource policies |
| `webview/src/components/` | Graph, operators, details, AI controls and per-query presentation |
| `webview/src/hooks/`, `webview/src/state/` | Layout and asynchronous request lifecycles, pure reducers |
| `test/helpers/` | Shared browser preview harness and verification process runner |

## Canonical data

QueryPlan schema 1.0 represents a rooted forest with unique node/edge IDs, valid endpoints, at most one parent per node, and no cycles or disconnected nodes. Nodes carry native identity, normalized category, object information, optional estimates/actuals and unknown native properties.

`application` contains typed DBTuna presentation fields such as the connection display label, statement identity, execution availability, plan kind and client elapsed time. `metadata` and node `properties` preserve extensible native information. Missing metrics stay absent rather than becoming zero.

Older canonical files that stored application fields in metadata are upgraded by the reader. Legacy batchSql is discarded. Original connection snapshots and declaration setup stay in host-side execution bindings. Serialized capability flags cannot authorize execution.

Cost and runtime scopes are explicit: SQL Server subtree costs differ from operator-local costs; PostgreSQL rows/times are per loop; SQL Server runtime aggregates use total rows/executions, summed CPU and maximum thread elapsed time.

## Engine behavior

PostgreSQL splits semicolon-delimited SQL lexically, validates each candidate using an AST parser and collects estimates in independent read-only transactions. Actual execution has a separate transaction that commits on success.

SQL Server preserves each GO-delimited compilation batch, then displays returned statements separately. Its adapter parses XML once, enforces whole-document limits and normalizes each statement tree. Scoped XML is serialized for native metadata without reparsing or decoding entities again. Actual collection identifies the selected statement among returned plans.

## State and messages

Webview-to-host messages use a strict Zod allowlist. Execution requests contain plan/request IDs, never connection or SQL overrides. AI requests contain IDs, optional user context and optional SQL for imported plans; the host resolves the displayed plan itself.

Execution and AI outcomes are discriminated unions. Successful execution must contain an actual plan and elapsed time; successful AI advice must contain validated structured advice and a model. Batch items use a discriminated schema so only complete items contain plans. UI reducers ignore obsolete replies and keep previous measured plans after a later error or cancellation.

The webview uses a ready handshake for the latest host snapshot and persists plan/view state for display restoration. Restored snapshots cannot enable execution; advice and actual-run results are session-local. Closing or replacing a plan cancels active work.

## Presentation

Canonical edges retain parent-to-child orientation. Compact presentation reverses displayed edges to show data flow from right-hand inputs to the left-hand result. Card view remains top-down. Edge width scales with estimated child rows; costs never become elapsed-time estimates.

Each query owns its graph provider and operator selection. Off-screen graphs mount near the viewport. The selected view is saved, and automatic fitting occurs after layout. Cost tooltips wait 500 ms and are dismissed on pointer departure, interaction or Escape.

## Limits and trust

Browser-safe policy constants live in `packages/plan-core/src/limits.ts`. Byte and character bounds are distinct; XML and object nesting have separate names even when configured equally. Graph, whole-batch and actual-document budgets are explicit. Database connection, estimate, actual, lock and cancellation timeouts are separate policies; AI model listing and advice also have separate timeouts.

See [security](security.md) for trust, data exposure and write semantics, and [verification](verification.md) for the evidence supporting the current implementation.

Completed plan snapshots carry an explicit rendering identity in application.snapshotId. Batch reconciliation reuses matching snapshots without serializing their native payloads; execution availability and its reason are compared separately. Snapshot identity never grants execution authorization. Restored snapshots discard that identity and disable execution until the host sends a live plan. Replacing content must create a fresh snapshot ID.
