# Security and data handling

[Documentation](README.md) · [Actual execution](getting-started.md#collect-an-actual-plan) · [AI assistance](ai-assistance.md)

## Credentials and connections

Database passwords and the OpenAI API key are stored in VS Code SecretStorage. Database type, host, port, database, user, TLS settings, authentication mode and display name are stored as profile metadata in globalState. The selected AI model ID is also stored there.

ProfileRepository owns persistence and the existing one-time legacy profile migration. Updating a connection requires a password; removing it deletes the associated secret. Connection setup prompts are separate from storage. Application code does not log SQL or credentials.

Use a least-privilege database role. Live database work and AI requests require a trusted workspace. TLS certificate verification uses the driver's/Node's trust configuration; explicit development options are described in the engine guides.

## Estimated plans

Explain Query does not collect an actual plan. PostgreSQL uses read-only transactions, bounded statement/client timeouts and rollback; SQL Server uses a dedicated SHOWPLAN_XML session with separate ON/query/OFF batches. Unsupported control, DDL and dynamic-execution statements are rejected before collection. Cancellation closes the active client and skips remaining work.

Planning is not an unconditional sandbox. PostgreSQL and database compilation can evaluate functions or perform other planning-related work. Estimated INSERTs do not intentionally execute writes, and integration tests verify unchanged target rows, but SQL classification is not a substitute for database permissions.

Oracle estimates write diagnostic PLAN_TABLE rows on a dedicated connection and roll them back; submitted business SQL is not executed. See [Oracle support](oracle-support.md) for permissions.

## Confirmed execution

Actual execution is an explicit, separate action. The host registers live estimates with their original profile snapshot and required setup context. SELECT and INSERT use the inline two-click Run/Are you sure? pattern followed by a modal VS Code confirmation showing the original connection, engine and SQL. The host checks workspace trust, current plan identity, SQL and unchanged connection configuration after approval and again after credential retrieval. Cancellation also requires two clicks. The original SQL remains in the query preview.

Requests carry IDs only. Imported data, persisted executionAvailable flags and webview-supplied identifiers cannot create a live binding. Original batch setup is host-only; SQL Server may reuse only required leading literal DECLARE statements, never earlier queries. Only one run can be pending or active, duplicate requests are blocked and no automatic retries occur.

PostgreSQL actual collection uses EXPLAIN ANALYZE with buffers and commits on success. SQL Server uses STATISTICS XML and autocommit. Oracle instruments a dedicated session, fully fetches SELECT results and identifies a uniquely tagged cursor. INSERT commits after runtime-plan validation; cancellation/commit errors preserve uncertainty. Normal result rowsets are discarded. All three engines use approximately 30-second execution limits; PostgreSQL also limits lock waits to 5 seconds.

**INSERT changes persist. SELECT functions execute.** Driver failures, disconnections, cancellation and plan-processing errors can occur after changes commit. Error messages preserve that uncertainty. Cancellation cannot guarantee rollback or undo external effects. Inspect the database before retrying a write.

## Webview and imports

Webview scripts/styles are bundled locally. A nonce Content Security Policy disallows external scripts and webview network access; inline styles support React Flow positioning. Local resource access is restricted to dist. React renders query text, names, native properties and advice as text rather than HTML.

Incoming messages must match a strict known schema. IDs, context and imported-plan SQL are bounded; credentials and arbitrary executable payloads are not accepted. Typed host responses distinguish success from errors and cancellation.

Files are size-checked before reading. JSON/XML and graphs are bounded and validated before layout. XML DTD/entity declarations are rejected, and entity-looking text is decoded exactly once. Imported batches restore pending/running entries as cancelled and never resume SQL. Unknown native attributes remain available for inspection.

Object inputs have the same aggregate UTF-8 JSON byte budget as text inputs, including keys and escaping. PostgreSQL dedicated sessions allow at most 5 MiB plus 64 KiB of protocol overhead, enforced on plaintext/decrypted TLS bytes before the driver's protocol parser. Oversized declared frames close the connection before their bodies arrive. This adapter is tested against the pinned pg driver; driver upgrades must retain those protocol tests. Decoded actual response limits are checked before PostgreSQL COMMIT.

Native database error messages, details, hints and causes are excluded from notifications, execution results and newly generated batch diagnostics. Only controlled application messages and mapped permission/authentication/timeout guidance are shown. Imported historical diagnostic text is omitted on restoration. This does not redact the SQL or native attributes that plans intentionally retain.

## AI requests

The host contacts only the configured OpenAI model-list and Responses endpoints. Model listing follows an explicit setup action; query/plan upload follows **Get AI advice**. Redirects are rejected, API keys stay in host-side authorization headers and provider error bodies are not displayed.

The advice payload includes query literals, object names and native operator attributes. It excludes credentials, connection labels, original batch setup and duplicate native XML. Structured responses are validated locally and rendered as plain text. Advice is ephemeral, is not exported and never applies SQL or schema changes. Requests enable no tools and set `store: false`; that flag is not a guarantee of zero provider retention.

## Sharing and limits

Exported plans/batches can contain SQL, connection display labels and sensitive native attributes. Review files and screenshots before sharing them. No telemetry or standalone backend is implemented.

| Boundary | Current limit |
| --- | --- |
| Selected SQL | 1 MiB |
| Plan/import and combined batch data | 5 MiB |
| Graph operators / edges | 1,000 / 1,000 |
| Combined batch operators | 5,000 |
| Query sections | 20 |
| XML / object nesting | 512 levels each |
| Traversed object values | 150,000 |
| AI input / response | 512 KiB / 2 MiB |
| AI context | 4,000 characters |
| AI advice / model listing | 90 seconds / 15 seconds |

The source of truth is [limits.ts](../packages/plan-core/src/limits.ts). See [verification](verification.md) for tested behavior and gaps.
