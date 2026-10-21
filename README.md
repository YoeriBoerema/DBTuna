# DBTuna

Explore PostgreSQL and SQL Server execution plans inside VS Code, beside your SQL editor. DBTuna provides a React Flow graph with ELK layout, operator details, estimated costs and cardinalities, raw attributes, pan/zoom, fit view, minimap, operator navigation and offline JSON import/export. No backend is required.

![DBTuna with an imported synthetic PostgreSQL plan](media/screenshot.png)

## Install

In VS Code, run **Extensions: Install from VSIX…** and select `dbtuna-0.6.1.vsix`. Then run **DBTuna: Load Sample Plan** for an offline demonstration.

## Explain a query

1. Open a trusted workspace and a `.sql` file.
2. Run **DBTuna: Add Connection**. Choose the connection type (PostgreSQL or SQL Server), then enter host, port, database, username, TLS preference and password. Passwords use VS Code SecretStorage.
3. Run **DBTuna: Manage Connections** and choose **Test Connection**.
4. Select one or more complete SQL statements, separated by semicolons. With no selection, DBTuna uses the entire file. Each statement must be SELECT, VALUES, INSERT, or WITH ending in SELECT or INSERT.
5. Run **DBTuna: Explain Query** from the Command Palette or SQL editor context menu. Select a connection if prompted.
6. Hover over an operator for half a second to see startup cost, total cost, estimated rows and row width. Move away to dismiss the tooltip. Click graph operators to inspect details. Use Auto layout, Fit view, zoom controls or the navigation dropdown.

You can also use the graph button in the top-right of a SQL editor. Explain Query is always available in the Command Palette, including for text files and PostgreSQL language modes; click the editor before invoking it. Selected log text is not stripped automatically.

Use **Select Connection** to switch profiles. **Manage Connections** supports testing, updating and removal. INSERT … SELECT, INSERT … VALUES, RETURNING and ON CONFLICT are supported as estimated plans. UPDATE, DELETE and data-modifying CTEs remain unsupported. The Explain Query command remains estimates-only. The separate actual-plan Run action executes SQL. Use a least-privilege database role: planning can invoke functions.

## Run and collect an actual plan (MVP)

After **Explain Query** on a live connection, each eligible SELECT or INSERT has a **Run query and collect actual plan** button. A VS Code confirmation names the original server/database and displays the exact SQL to execute. Successful INSERTs commit changes and may fire triggers. Repeating Run repeats the query and its effects. SQL, including SELECT functions, actually executes. Cancellation does not promise to undo committed work.

Each query retains **Estimated / Actual** tabs. Actual results show measured operator rows, executions/loops and available timings. PostgreSQL rows/times are per loop; SQL Server rows/executions sum across threads, CPU sums across threads, and elapsed time is explicitly the maximum thread value. Native properties retain buffers, I/O, warnings and other engine-specific details. Client elapsed time includes connection/network overhead. The MVP does not provide a query results grid or live partial plan.

Use **Cancel execution** to close the active connection. Failed/cancelled execution keeps the estimate and any previous successful actual plan; outcome messages warn that data may already have changed. Execution is single-flight and never automatically retries. Timeout is approximately 30 seconds per query (PostgreSQL also has a 5-second lock timeout). Plan collection/parsing can fail after the SQL has committed, so check the database before retrying an INSERT.

The action runs only the chosen statement, not the whole file or surrounding batch. SQL Server may reuse necessary leading single-variable DECLARE statements with literal values; other variable setup, SELECT INTO and unsupported statement forms are disabled for this MVP. Earlier SELECTs/INSERTs are never replayed to establish context. Run a fresh Explain if the connection changes or after reloading the extension. Imported plans cannot authorize execution.

**Export actual plan** saves the latest measured canonical plan separately. The existing global export still saves the estimated plan/batch. Actual-run state is session-local and is not automatically restored or resumed. AI Assistance on the Actual tab uses the actual plan. PostgreSQL uses explicit `EXPLAIN (ANALYZE TRUE, BUFFERS TRUE, FORMAT JSON, ...)` in a bounded transaction and commits on success; SQL Server uses `SET STATISTICS XML ON` on a dedicated connection, discarding normal result rows while collecting Showplan XML.

Live PostgreSQL SELECT/INSERT execution was verified on an isolated test instance. SQL Server actual collection has unit/protocol/UI coverage and an opt-in integration test, but was not tested against a running SQL Server here.

## AI Assistance

Open **DBTuna: AI Assistance** from the Command Palette, the SQL editor's right-click submenu, or the plan header. Its subitems are **Set API Key**, **Select Model**, and **Remove API Key**. The API key is stored in VS Code SecretStorage; only the chosen model ID is saved in globalState. The model picker loads text-model candidates available to your key, and also accepts a manual model ID. Choose a model supporting the OpenAI Responses API; model-list availability alone does not establish endpoint compatibility.

Select an operator and use its **AI Assistance** panel. Add optional context, then click **Get AI advice**. For imported plans without query text, paste the query into the provided SQL box. The host sends the displayed statement, engine/version, complete normalized plan with native operator attributes, selected operator and context to `https://api.openai.com/v1/responses`. Connection labels, the stored credentials, duplicate native XML and unrelated batch SQL are excluded. Query literals and object names are included. Sending occurs only on this button press; no automatic analysis or database changes occur. Workspace trust is required. OpenAI API billing/account access is separate from configuring the extension.

AI Assistance appears at the bottom of operator details, after native attributes. Responses start with an AI-assessed whole-query score from 1 (extremely poor plan) to 100 (no easy improvements evident), followed only by up to three short suggestions and the full proposed query when suggestions exist. The score is not a runtime measurement or completion guarantee. Index/statistics-only advice includes the original query unchanged rather than inventing a rewrite. Responses use a validated JSON schema; the selected model must support structured outputs. Incomplete responses are rejected rather than presenting partial SQL. Advice is displayed as plain text with the responding model, loading/error states and cancellation. Changing operators, closing the plan or replacing it cancels pending advice. Advice is not saved in plan exports or persistent webview state. Requests set `store: false`, use no tools, allow up to 8,192 output tokens and time out after 90 seconds. Inputs exceeding 512 KiB and replies exceeding 2 MiB fail explicitly instead of silently truncating. Existing suggestions are for review; DBTuna never executes suggested SQL.

API reference: [Responses](https://developers.openai.com/api/docs/guides/text), [account model list](https://developers.openai.com/api/reference/resources/models/methods/list).

## SQL Server

Choose **SQL Server** in **Add Connection**. Use a hostname and explicit TCP port (default 1433), database, credentials and TLS preference. SQL authentication and explicit domain/username/password NTLM are supported. Automatic Windows integrated sign-in and Entra sign-in are not included. Named instances require their actual TCP port; instance discovery is not implemented. Certificate verification is the default; development connections can explicitly trust the server certificate.

Explain supports SELECT, INSERT and WITH queries, plus DECLARE statements in the same batch as a query. Semicolons preserve dependent T-SQL statements together. A standalone `GO` line separates batches, including `GO -- comment`; GO repeat counts, SQLCMD commands, SET, EXEC, DDL, UPDATE and DELETE are rejected. Up to 20 GO-delimited batches are accepted. Each statement plan appears in its own numbered query section, including semicolon-separated statements. Statements are still compiled together within their GO-delimited batch to preserve variable context. Imported multi-statement .sqlplan files are separated the same way.

The collector opens a dedicated connection, sends `SET SHOWPLAN_XML ON` as its own batch, collects the selected query batch, then disables Showplan and closes the connection. Submitted statements are not executed. Temporary-table creation scripts are not supported. The login needs statement permissions and SHOWPLAN permission in every referenced database. No server helper or external service is required.

Import existing `.sqlplan` or `.xml` files, including UTF-16 files saved from SSMS. Operators retain native properties, accessed objects, predicates and warnings. SQL Server total cost means **estimated subtree cost**; CPU/I/O estimates appear in tooltips and details. SQL Server runtime counters are normalized with explicit total-row, summed-CPU and max-thread-elapsed semantics; original counters also remain in native properties. Costs cannot be compared across database engines.

Version 0.4 resets legacy saved connections and their associated secrets once when first activated. New profiles contain a required `type` field (`postgresql` or `sqlserver`) and persist normally afterward.

## Explain multiple queries

Use the same **DBTuna: Explain Query** command with several statements selected, or a SQL file containing several statements and no selection. DBTuna validates each statement, then requests estimated plans sequentially using the chosen connection.

Each numbered query section has its own expandable SQL preview, status, estimated plan cost, graph, operator navigation and details. A failed or unsupported query gets an error in its own section; other plans remain visible. Use **Cancel batch** or the notification cancellation control to stop remaining work while keeping finished plans. Global Fit view, Auto layout and Plan view controls apply to mounted graphs. Off-screen graphs initialize as you scroll.

**These statements are explained, never executed.** Earlier INSERTs do not populate data for later queries; CREATE/TEMP setup and unsupported statement types are not run. Each plan uses a separate read-only transaction/connection, not a shared batch snapshot. Limits: 20 statements, 1 MiB selected SQL, 5,000 combined operators and 5 MiB exported batch data. Ambiguous or unfinished quoting stops the batch before any database request. Semicolons in strings, quoted identifiers, dollar quotes and comments are handled without blind splitting.

![Numbered query plans and an isolated query error](media/batch-plans.png)

## Visualization views

Use the **Plan view** selector in the header. **Compact horizontal** is the default: the result operation is on the left, inputs branch to the right, and arrows point left to show data flow. Operator icons have labels, relation names, cumulative estimated costs and estimated rows underneath. Line widths scale logarithmically with child row estimates (1–5 units within the current plan); missing estimates use a thin line. Costs remain engine-specific optimizer units, not elapsed time or per-operator percentages.

Choose **Cards · top down** to return to the original view. Switching views preserves the selected operator and saves the view preference in webview state. Both views support pan/zoom, fit, auto layout, selection, details and the half-second cost tooltip.

![Compact horizontal PostgreSQL INSERT plan](media/horizontal-plan.png)

## Import and export

**Export batch** saves all results, SQL previews, statuses and errors in a DBTuna batch envelope; **Import Execution Plan** restores it without connecting or resuming work. One successful query still exports the canonical single-plan format.

**Import Execution Plan** also accepts raw PostgreSQL JSON (`[{"Plan": …}]`), JSON-encoded output, and DBTuna canonical 1.0 JSON. Import requires no connection. **Export Execution Plan** saves the canonical graph, query text when present, metadata and unknown native properties. Synthetic samples are explicitly labeled. Imported actual execution statistics are shown separately from estimates.

## Develop

Use Node.js 22 or later and npm:

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run test:vscode
npm run package
```

Press F5 to launch the configured Extension Development Host. pnpm is also supported (`pnpm install`, then `pnpm run …`). Package code is bundled; the installed extension does not require node_modules.

For a real isolated database integration test, run `node test/integration/embedded.mjs`. This uses the development-only embedded-postgres binary package, a localhost-only test server on port 55439 and test credentials. Alternatively, provide your own disposable test PostgreSQL server with the test credentials in `test/integration/postgres.test.ts` and run `npm run test:postgres`. Never point these tests at production.

For opt-in SQL Server integration, provision a disposable instance on `127.0.0.1:55440` with database `dbtuna_integration` and a test-only `sa` password. Set `DBTUNA_SQLSERVER_TEST=1` and `DBTUNA_SQLSERVER_TEST_PASSWORD`, then run `node --import tsx --test test/integration/sqlserver.test.ts`. The test creates and drops a uniquely named table and verifies INSERT explanation leaves row counts unchanged. Live SQL Server testing was unavailable in this build environment; fixture, protocol-sequence and UI checks do not substitute for that test.

## Limits and verification

PostgreSQL 18.4 was verified with live SELECT, join and six INSERT plan forms (including the generator lookup), unchanged target row counts, invalid SQL and read-only enforcement. PostgreSQL 14+ is targeted; older supported versions have not been tested here. The AST parser supports common PostgreSQL syntax and rejects unsupported constructs, including some valid native syntax. Dollar-quoted expressions and INSERT DEFAULT VALUES may be rejected by the AST parser.

Import limits: 5 MiB, depth 64, 1,000 operators. Graphs must form a rooted forest. TLS uses Node's certificate trust store; custom certificate pickers are not included. No results grid, persistent execution history, automatic tuning, or side-by-side plan comparison is implemented. Optional heuristic diagnostics are deferred.

See `docs/verification.md` for exact test results and remaining verification gaps, and `docs/security.md` for planning and credential handling.
