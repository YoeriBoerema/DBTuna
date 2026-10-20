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
