# Security

Passwords live exclusively in VS Code SecretStorage. Host, port, database, username, TLS preference and display name are stored in globalState. Updating a profile requires re-entering the password. Removing a profile deletes its secret. Connection strings and SQL are not logged by application code. Exported plans may include query text and sensitive native attributes; review the chosen export destination.

Use a least-privilege role. EXPLAIN without ANALYZE does planning, but PostgreSQL may evaluate functions during planning. SQL classification and read-only transactions reduce risk; they are not an unconditional execution sandbox. Live access requires a trusted workspace. No standalone user SQL is submitted to generate results.

Webview scripts are bundled locally and protected by a nonce CSP. External scripts and network access are disallowed. Inline styles are permitted for React Flow's dynamic positioning. React escapes operator names, predicates and metadata. Local resource access is limited to dist. Incoming messages must contain exactly one known type and no payload.

No telemetry, account, backend, AI integration, or external plan upload is implemented. Large imports are rejected before reading by the extension and before normalization by the core. Imported graphs are validated before layout.

INSERT support requests a plan only: the host still prepends EXPLAIN (FORMAT JSON, VERBOSE TRUE, COSTS TRUE), never enables ANALYZE and retains BEGIN READ ONLY, statement timeout and ROLLBACK. Only the main statement may INSERT; data-modifying CTEs remain rejected. Batches are split into independent validated statements; an unsplit multi-statement string never reaches the collector. ON CONFLICT actions are part of that estimated INSERT plan. Target table row counts were verified unchanged in disposable PostgreSQL integration tests. Ordinary expression calls such as COALESCE are accepted; standalone CALL statements remain rejected. See [PostgreSQL EXPLAIN documentation](https://www.postgresql.org/docs/18/sql-explain.html).

Batch planning retains successes across query failures. Cancellation closes the active client and skips remaining statements. Each query gets its own read-only transaction, timeout and rollback. Imports restore saved results only; pending/running imported entries become cancelled. Batch envelopes are Zod validated, preserve local canonical graph invariants and are bounded to 20 items, 5,000 operators and 5 MiB. Selected SQL is limited to 1 MiB.
