# DBTuna engineering

The extension host in `src/extension` owns all VS Code and PostgreSQL access. The React webview consumes the canonical graph only. `packages/plan-core` owns Zod schemas and graph invariants; `adapter-sdk` defines the adapter boundary; `adapter-postgres` owns native mappings and parsing.

Use strict TypeScript. Preserve unknown native attributes, optional metrics and child order. Never interpret optimizer costs as milliseconds. React must render native strings as text.

Development: `npm install`, `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run test:vscode`. `npm run test:postgres` requires a disposable PostgreSQL server on localhost:55439 with test-only credentials as defined in the integration test. `node test/integration/embedded.mjs` provisions an isolated development server instead.

Keep credentials in SecretStorage and metadata in globalState. Never log SQL or credentials. Never add ANALYZE, telemetry, external services, or webview database access. Batches may contain up to 20 statements. Explain each validated SELECT, VALUES, INSERT, or WITH ending in SELECT or INSERT statement separately, within a read-only transaction and with bounded timeouts. All automated database work must target an isolated test instance. Do not use production credentials.
