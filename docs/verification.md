# Verification

[Documentation](README.md) · [Development](development.md)

Source version: see [generated build information](build-info.md). Verification recorded **23 October 2026** for the v0.6.14 refactor release. This page reports evidence from this development environment, not a guarantee across all supported databases or systems.

## Current checks

| Check | Result and scope |
| --- | --- |
| Unit tests | 90 passed: native fixtures, validation, graph/batch invariants, connectors, execution binding, profile storage, AI transport and asynchronous state |
| Formatting, TypeScript and ESLint | Passed, including packaging scripts, browser helpers and generated build-information checks |
| Host and webview bundles | Built successfully |
| Browser suites | All seven suites passed in headless Edge: layout, navigation, 500 ms tooltips, view switching, query sections, actual controls, local analysis/navigation, resizing and AI presentation |
| PostgreSQL integration | Passed on disposable PostgreSQL 18.4: estimates, joins, six INSERT forms, unchanged estimate row counts, actual SELECT, committed actual INSERT, rollback and cancellation |
| VS Code activation | Passed on isolated VS Code 1.96.4: activation, command registration, sample panel and SQL editor |
| VSIX packaging | Version-derived package built and verified: archived manifest and runtime hashes match this checkout; packaging does not install or publish it |
| Live SQL Server | Not run; fixtures, protocol, normalization and browser checks passed |
| Live OpenAI requests | Not run; mock transport and UI checks passed |

Additional regressions cover deep Showplan trees, numeric XML line endings, escaped entity-looking SQL, single-pass XML parsing, whole-document operator budgets, per-statement batches, host-only declaration context, invalid-profile persistence, one-time migration, stale replies and operation-specific timeouts.

## Reproduce

From the repository root with Node.js 22 or later:

```sh
npm install
npx playwright install chromium
npm run verify
npm run verify -- --postgres --vscode
npm run package
```

The second verify command repeats the main checks and adds integration; use one or the other depending on the desired coverage. `DBTUNA_BROWSER` selects an installed Chromium-family executable. `VSCODE_EXECUTABLE` selects an existing compatible VS Code executable; otherwise the test runner uses its usual executable setup.

Normal browser verification writes only ignored work files. After building, `npm run screenshots` explicitly regenerates tracked screenshots. The shared harness is in [test/helpers](../test/helpers), and the verification entry point is [test/verify.mjs](../test/verify.mjs).

## Isolated database tests

`npm run test:embedded` creates and stops a localhost-only PostgreSQL instance on port 55439 with test-only credentials. It does not use saved extension connections. Generated test data stays under ignored work directories.

For SQL Server, provision a disposable instance at `127.0.0.1:55440` with database `dbtuna_integration`, set `DBTUNA_SQLSERVER_TEST=1` and `DBTUNA_SQLSERVER_TEST_PASSWORD`, then run:

```sh
node --import tsx --test test/integration/sqlserver.test.ts
```

This opt-in test creates/drops a uniquely named table and verifies estimated and actual SELECT/INSERT behavior. It performs writes. See [development](development.md#database-integration) for PowerShell setup.

## Remaining gaps

- PostgreSQL 14-17 compatibility is a target, not verified here.
- Live SQL Server, including actual execution, permissions and authentication against a real server, remains unverified here.
- OpenAI account/model compatibility and live API responses were not tested with a real key.
- Connection/setup dialogs, all real VS Code themes, assistive technologies and a full manual editor-to-database walkthrough need further coverage.
- Native SQL parser support is intentionally narrower than each database's full grammar.
- Browser timing observations are smoke checks, not performance guarantees.

Older checkpoints are in the [verification history](archive/verification-history.md). They preserve historical counts and behavior and should not be used as current instructions.

Refactor regressions also cover snapshot identity across serialization and execution-availability changes, explicit confirmation/display transitions, connector classification, all conversion warnings with provenance, per-rule applicability reasons and version-derived artifact naming. Tests are grouped by behavior and share native fixture builders. The PostgreSQL integration expectation for an unsupported DELETE was refreshed from Failed to Skipped to match the existing tolerant Explain behavior.

## Estimated-analysis working tree

After v0.6.14, the estimated-analysis additions passed 95 unit tests, formatting, TypeScript, ESLint, build and all eight browser suites. New tests use plans without actual counters for both PostgreSQL and SQL Server, checking estimated-risk labels, operator navigation, conservative loop inference, missing-index statement scope and constant-only predicate exclusions. Live database collection was unchanged; PostgreSQL integration and VS Code activation above refer to the refactor verification. These additions are not yet installed or released.
