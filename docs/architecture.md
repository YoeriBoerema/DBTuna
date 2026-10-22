# Architecture

SQL editor → selected text (or whole file) / AST validation → extension-host PostgreSQL collector → PostgreSQL adapter → canonical QueryPlan → typed webview message → ELK layout → React Flow.

The collector uses a fresh pg client for each operation, a five-second connection timeout, a twelve-second client query timeout and a ten-second transaction statement timeout. It issues BEGIN READ ONLY, SET LOCAL, SHOW server_version, EXPLAIN, and ROLLBACK as separate protocol statements. Cancellation closes the client. The finally path releases resources even after failures.

The UI imports canonical types only. Passwords and connection objects never cross the host boundary. Webview commands are a finite, validated allowlist. A ready handshake prevents loss of initial state; the latest status is sent when ready. Plans survive hidden panels and webview state reloads; reopening a disposed panel starts a new view.

Imports are bounded to 5 MiB, 512 nesting levels, 150,000 values and 1,000 graph operators. Graph validation requires unique IDs, valid endpoints, an acyclic rooted forest and no disconnected nodes. Layout uses the layered ELK algorithm with parent-to-child direction. Deterministic PostgreSQL IDs follow tree paths.

The presentation layer supports compact horizontal and top-down card layouts. ELK still lays out the canonical parent-to-child graph; compact view displays edges in reverse (child → parent) with left-pointing arrowheads to represent data flow. Exported canonical graphs retain their original parent-to-child direction and ordering. Compact operator pictograms are local SVG React components and use the existing normalized categories.

For batches, lexical boundary scanning accounts for comments/quotes and fails closed on ambiguity, followed by PostgreSQL AST validation of each exact candidate. The batch service tracks ordered pending/running/complete/error/cancelled items and calls the existing collector sequentially. Complete plans keep independent canonical IDs and graph direction. A typed BATCH_LOADED snapshot updates the webview. Each numbered section owns a React Flow provider and independent selection; near-viewport lazy mounting bounds initial layout work. A versioned dbtuna-batch envelope handles import/export without changing the canonical QueryPlan format.


## Responsibility boundaries

`extension.ts` wires services and registers VS Code commands. `ExplainCoordinator` owns selection, progress and batch cancellation; `PlanFiles` owns sample loading and file import/export. `ExecutionManager` remains the only coordinator for confirmed actual execution and keeps original connection snapshots and SQL declaration context in host-only bindings.

The host-side `DatabaseConnector` contract covers dialect-specific splitting, validation, estimated/actual collection, native parsing, execution preparation and actual-statement selection. PostgreSQL and SQL Server implementations live under `src/extension/connectors`. The existing adapter SDK remains independent of VS Code and database drivers and owns native-to-canonical parsing only.

Canonical plans separate typed DBTuna `application` fields (connection display label, statement identity, execution availability and measurement presentation) from extensible native `metadata`. The 1.0 reader upgrades older plans that stored application fields in metadata and discards legacy `batchSql`; new exports do not contain host execution setup. Imported or restored snapshots do not authorize execution. The host must register a freshly explained plan on its original connection.

The React entry screen composes focused components under `webview/src/components`. Layout, actual execution and AI request lifecycles live in hooks under `webview/src/hooks`; `vscodeApi.ts` owns acquisition of the VS Code API and restoration of saved view state. The 500 ms tooltip, graph orientation, selected operators and request cancellation behavior remain unchanged.


## Medium-priority maintainability refactor

SQL Server validates and parses the XML document once, enforces the operator budget across all statements, and normalizes statement trees directly. Scoped native XML is serialized for export metadata without reparsing it. Numeric XML references still decode exactly once.

Execution and AI replies use discriminated outcome types. Successful execution includes a measured plan and elapsed time; successful advice includes validated structured advice and its model. Pure UI reducers own asynchronous transitions and ignore obsolete replies. Batch items also use a discriminated schema so only completed items carry plans.

`ProfileRepository` owns profile storage, active selection, secrets and the existing one-time migration. `connectionWizard.ts` owns prompts; `ConnectionManager` coordinates them. Profiles are a union of PostgreSQL and SQL Server variants, and original-connection checks compare configuration fields explicitly.

Browser-safe `plan-core/src/limits.ts` names byte/character, nesting, graph and batch budgets separately. Database connection, estimated execution, actual execution, lock and cancellation timeouts retain distinct names. AI model-list and advice requests also have explicit timeout policies.

Shared `advice.ts` owns validation; the provider JSON schema derives from it, with cross-field checks remaining local. Host AI code separates input selection, instructions and bounded HTTP transport. Advice stays structured across the host/webview boundary, and the UI formats it as plain text. Advice is still ephemeral and never automatically executes SQL.
