# Verification — 20 October 2026

## Passed

- Strict TypeScript typecheck and ESLint.
- Production esbuild bundles for extension host and webview.
- 21 unit tests: ten PostgreSQL fixtures (including a captured PostgreSQL 18.4 plan), canonical round trips, graph invariants, unknown attributes, imported actual metrics, bounded input, selected-text/whole-file input and SQL classification, 101-node normalization, profile serialization and TLS configuration.
- Live PostgreSQL 18.4 integration: connection, SELECT EXPLAIN, join EXPLAIN, absence of actual metrics, invalid-column error, client rejection of DELETE and server read-only write rejection. A disposable localhost-only PostgreSQL server was shut down gracefully afterward.
- VS Code 1.96.4 Extension Development Host: extension activation, all seven command registrations, loading the sample webview and opening a SQL editor.
- Headless Edge: React Flow rendering, ELK layout, node selection/details, import/export message dispatch, light-theme token simulation and forced-colors rendering. A 101-node graph layout plus selection completed in approximately 215 ms in this environment; this is a smoke measurement, not a performance guarantee.
- VSIX packaging with @vscode/vsce and installation into an isolated VS Code profile.

The machine's normal VS Code installation was blocked by an updater mutex, so a separate VS Code 1.96.4 archive was used. Tests did not alter the user's VS Code profile or configured databases.

## Remaining manual coverage

Connection wizard cancellation at each field, operating-system SecretStorage behavior, certificate validation against a real TLS server, full editor-command-to-live-database interaction, import/export native file dialogs, query cancellation under an active slow planner, permission-denied roles and statement timeout conditions are implemented but not all exercised end to end here. The browser tests use simulated light theme tokens; actual light/dark/high-contrast VS Code theme inspection remains manual. PostgreSQL 14–17 have not been tested.

No claim is made that every acceptance criterion has complete automated coverage. Optional heuristic diagnostics are not implemented.

## Reproduce

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run test:embedded
npm run test:vscode
npm run package
```

For browser tests: `npx playwright install chromium`, then `node test/render.mjs`. Set `DBTUNA_BROWSER` to an installed Chromium-family executable to use it instead. Set `VSCODE_EXECUTABLE` to a compatible VS Code executable to skip the integration runner's download.

## 0.1.2 update

Explain Query uses exactly the selected text, or the entire file when there is no selection. Whitespace selections are rejected without falling back to the file. Typecheck, lint, build and all 21 unit tests pass for this release. Multiple statements and unsupported write statements remain rejected.

## 0.1.3 INSERT support

INSERT SELECT/VALUES, WITH SELECT … INSERT, RETURNING, ON CONFLICT and the reported generator lookup are covered. PostgreSQL 18.4 integration generates six INSERT plans under the unchanged read-only EXPLAIN workflow and verifies target table counts remain unchanged. A real ModifyTable fixture is retained; its display label is Insert while native attributes survive. Function expressions such as COALESCE are no longer misclassified as standalone CALL statements. UPDATE, DELETE, ANALYZE, modifying CTEs and multi-statement inputs remain rejected.

Release validation: 25 unit tests, strict TypeScript typecheck, ESLint, production build and browser graph/INSERT details checks passed.

## 0.1.4 delayed cost tooltips

Operator tooltips display live plan estimates after a continuous one-second hover. Browser clock tests verified absence at 999 ms, visibility after 1001 ms, dismissal on leave and Escape, cancellation before the threshold and a fresh delay on re-entry. Tooltips render outside the zoomed graph so text stays readable. Typecheck, lint, build and browser rendering checks passed. No database collector changes were made.

## 0.1.5 hover delay

Hover delay reduced to 500 ms. Browser clock checks verify no tooltip at 499 ms, visibility at 501 ms, cancellation on leaving early, and a fresh delay on re-entry.

## 0.2.0 compact horizontal view

Added a persisted compact/card selector, operator pictograms, result-left horizontal layout, left-pointing data-flow arrows and logarithmically scaled estimated-row edge widths. Canonical graphs and exports are unchanged. New unit tests cover edge direction, graph immutability, ordering, row-based widths and missing estimates. Browser checks cover initial horizontal layout, switching to top-down cards and back, preserved selection and stored view preference, half-second tooltip behavior, theme rendering, a 101-node plan and INSERT details.

Release checks: 27 unit tests, TypeScript typecheck, ESLint, production build and browser checks passed. The 101-node compact layout and selection smoke check completed in approximately 227 ms in this environment.

## 0.3.0 multi-query plans

Batch unit coverage includes exact selection scope; lexical strings, identifiers, E strings, dollar quotes and nested comments; unclosed/ambiguous quoting; 20-statement/1 MiB bounds; sequential collection; syntax/unsupported/database error isolation; cancellation preserving earlier plans; unique plan identities; batch round trips and import normalization. PostgreSQL 18.4 mixed-batch integration returns three successful plans and two isolated errors and verifies the INSERT left table counts unchanged. Browser checks cover separate query sections, independent selection, SQL previews, cancel/export messages, view switching and saved batch state. Existing tooltip, themes, 101-node graph and single-plan checks pass.

Release checks: 34 unit tests, strict typecheck, ESLint, production build, PostgreSQL 18.4 integration, browser batch checks and the actual VS Code exact-selection batch command passed. The Extension Host command test uses unsupported statements to verify per-query errors without configuring a database. Native import/export file dialogs and the connection wizard still retain the earlier manual coverage limitations.

## SQL Server addition - 21 October 2026

Version 0.4.0 adds typed connection profiles, SQL Server transport, Showplan XML normalization, GO-delimited dependent batches, UTF-8/UTF-16 plan import and engine-aware cost labels. SQL authentication and explicit NTLM domain credentials are implemented; integrated sign-in and Entra are outside this release. SELECT, INSERT, WITH and DECLARE/query batches are supported; UPDATE/DELETE, DDL, SET, dynamic execution and SQLCMD directives are rejected.

Passed: 42 unit tests, TypeScript, ESLint, production builds, existing PostgreSQL 18.4 isolated integration, VS Code 1.96.4 activation, existing browser regressions and SQL Server fixture rendering (four operators, two statement roots, native properties, subtree metrics and delayed tooltip). The SQL Server fixture is illustrative and explicitly marked synthetic, not captured from a server.

SQL Server live collection, NTLM and real certificate validation remain unverified: Docker is installed but its engine was not running. An opt-in test in `test/integration/sqlserver.test.ts` targets only localhost:55440/dbtuna_integration and checks SELECT, INSERT row-count invariance, dependent statements, invalid SQL and pre-cancellation. It was not run against a live server.

At the user's explicit request, the normal VS Code storage had DBTuna connection metadata reset and four password entries deleted. No unrelated extension storage was changed. The one-time connection migration clears legacy profiles on first 0.4 activation; newly created profiles persist.

## SQL Server statement sections - 0.4.1

SQL Server Showplan responses are now normalized into individual statement plans before displaying batch results. Each receives its own query text, graph, cost, selection and status. Native GO batches remain intact during collection, preserving DECLARE/query compilation context. Imported multi-statement Showplan files also produce separate query sections. Repeated identical SQL is not deduplicated. New regression tests use the reported three join queries, verify one collection call produces three independent results, and cover subsequent batches, cancellation and the 20-result limit.

## AI Assistance - 0.5.0

Added AI Assistance commands and a native SQL-editor submenu with Set API Key, Select Model and Remove API Key. The operator detail panel sends the displayed query, normalized plan, engine/version, selected operator and optional context through host-side OpenAI Responses requests. Account model discovery uses GET /v1/models with a manual-ID fallback. Credentials remain in SecretStorage; response messages are ephemeral and output is plain React text. No SQL execution is attached to advice.

Passed: 49 unit tests; TypeScript and ESLint; browser checks for explicit requests only, correct plan/operator/context payloads, rejected stale replies, isolation between query sections, plain-text rendering, cancellation, settings dispatch and no advice in saved plan state. Existing PostgreSQL/SQL Server visualizer browser checks also passed. OpenAI client tests use an injected mock fetch transport to verify authorization placement, exact URLs, store:false, bounded input/output, response extraction, model filtering, provider-status sanitization, network failures, cancellation and incomplete responses.

No live OpenAI request was made: no dedicated API key was supplied for development. Model access, account quota/billing and real network/TLS behavior must be confirmed after configuring a key. The model-list endpoint does not guarantee Responses compatibility; unsupported models return a clear error and can be changed through the selector.

## Concise scored advice - 0.5.1

AI Assistance moved below native attributes at the bottom of operator details. Responses now use strict structured output and local validation: integer score 1-100, one short score reason, up to three suggestions (200 characters each), and a complete proposed query whenever suggestions exist. Only the score paragraph, Suggestions and conditional Updated query blocks are rendered; provider model attribution follows the content. Score is a qualitative AI assessment, not a runtime/completion guarantee. Index/statistics-only recommendations keep the original query unchanged. Invalid or incomplete output fails explicitly rather than displaying partial SQL.

Tests cover score endpoints/out-of-range values, missing proposed queries, excess suggestions, unexpected fields, and no-suggestion output. Browser regression asserts that AI Assistance is the final detail-panel child and the response starts with the score and includes proposed SQL. No live OpenAI call was made for this change.

## Actual plan MVP - 0.6.0

Added a separate confirmed runtime action for individual SELECT/INSERT plans on PostgreSQL and SQL Server, with original connection binding, one active run, elapsed status, cancellation, Estimated/Actual tabs and separate actual-plan export. AI can inspect the actual plan. Runtime state is ephemeral and import never enables execution. Normal query results are discarded; actual plans remain bounded.

Passed isolated PostgreSQL 18.4 integration: actual SELECT counters, actual INSERT counters and exactly one committed inserted row, duplicate-key rollback, pre-cancelled INSERT without changes, and all previous estimated-plan no-write checks. SQL Server STATISTICS XML request sequencing/cleanup and aggregate runtime metrics are unit-tested; the opt-in localhost integration test now covers actual SELECT and persistent INSERT, but no SQL Server instance was available to run it.

Execution guards tested: current host bindings only, trust and confirmation, original-profile matching, no browser-supplied SQL/connection, single-flight INSERTs, no automatic retries, uncertainty after failures and bounded literal declaration context without replaying earlier statements. Browser tests cover explicit run dispatch, scoped responses, measured row display, Estimated/Actual switching, progress/cancellation/error states, offline-disabled action and actual export.

MVP limitations: 30-second execution timeout, no results grid or live in-flight plan, no persistent actual history, limited SQL Server variable setup, trigger-plan identification may fail after execution, and row/time semantics differ by engine. SQL Server live collection and native cancellation remain verification gaps.

Final MVP checks: 58 unit tests, TypeScript, ESLint, production build, VS Code 1.96.4 activation, isolated PostgreSQL execution integration and browser regressions passed. Runtime toolbar layout includes a footer-visibility check so the new controls do not clip the graph/navigation. SQL Server live integration remains unrun.

## SQL Server XML line breaks - 0.6.1

Confirmed fast-xml-parser left numeric XML character references in StatementText. Their semicolons reached execution validation and incorrectly disabled the Run action. Attribute/text values now decode XML predefined and numeric references exactly once with parser entity processing disabled, in both the original and per-statement parse paths. Invalid XML code points are rejected. Regression tests cover the reported three join queries with hexadecimal/decimal CRLF references, execution validation, named entities, supplementary Unicode characters and escaped entity-looking SQL literals without double decoding. A browser check verifies real line breaks in the SQL preview. Existing cached/canonical plans are not rewritten; a fresh Explain regenerates corrected statement text.
