# DBTuna engineering

The extension host in `src/extension` owns all VS Code and PostgreSQL access. The React webview consumes the canonical graph only. `packages/plan-core` owns Zod schemas and graph invariants; `adapter-sdk` defines the adapter boundary; `adapter-postgres` owns native mappings and parsing.

Use strict TypeScript. Preserve unknown native attributes, optional metrics and child order. Never interpret optimizer costs as milliseconds. React must render native strings as text.

Development: `npm install`, `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run test:vscode`. `npm run test:postgres` requires a disposable PostgreSQL server on localhost:55439 with test-only credentials as defined in the integration test. `node test/integration/embedded.mjs` provisions an isolated development server instead.

Keep credentials in SecretStorage and metadata in globalState. Never log SQL or credentials. Never add ANALYZE, telemetry, external services, or webview database access. Batches may contain up to 20 statements. Explain each validated SELECT, VALUES, INSERT, or WITH ending in SELECT or INSERT statement separately, within a read-only transaction and with bounded timeouts. All automated database work must target an isolated test instance. Do not use production credentials.

SQL Server: use dedicated Tedious connections and separate SHOWPLAN_XML ON/query/OFF batches. Never execute submitted SQL with Showplan disabled. Preserve dependent statements inside GO-delimited batches; validate query-only T-SQL and reject SET, dynamic execution and DDL. No read-only transaction is required for Showplan compilation; test all live work against isolated instances only.

AI assistance is explicitly user-authorized: the extension host may call only https://api.openai.com/v1/models and /responses for API-key/model setup and explicit advice requests. Store the API key in SecretStorage, model ID in globalState; never expose keys to webviews, logs, plans or exports. Advice sends the chosen statement and plan only, never connection metadata or unrelated batch SQL. No advice-triggered SQL execution. Validate all webview payloads, bound inputs/responses, and support cancellation. Tests use mock transport unless a dedicated test key is explicitly supplied.

Actual execution is now explicitly authorized by the user for the MVP: a separate confirmed run action may use PostgreSQL EXPLAIN ANALYZE with BUFFERS and COMMIT, or SQL Server STATISTICS XML. Never activate execution from Explain, AI advice, import or export. Bind runtime actions to host-registered live estimated plans and their original connection. Support single SELECT/INSERT only, discard result rows, impose bounded timeouts, never auto-retry, and warn on uncertain write outcomes. Automated execution tests must remain isolated.
