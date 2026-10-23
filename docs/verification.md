# Verification

[Documentation](README.md) · [Development](development.md)

Verification recorded **23 October 2026** for **0.7.0 - The Oracle Has Arrived!** Source version: [build information](build-info.md). Results describe this development environment, not a guarantee across every database/version.

## Release checks

| Check | Result and scope |
| --- | --- |
| Unit tests | 116 passed, including Oracle lexical boundaries, adapters, analysis, collector protocol, commit/rollback, cancellation, LOB cleanup and bundled Thin driver transport |
| Formatting, TypeScript and ESLint | Passed |
| Host and webview | Built successfully; Oracle driver and notices are bundled |
| Browser suites | All nine passed in isolated headless Edge, including Oracle query sections, inline execution confirmation, actual/estimated switching and finding navigation |
| PostgreSQL integration | Passed on disposable PostgreSQL 18.4, including unchanged estimate row counts, SELECT/INSERT actual plans, committed INSERT, rollback and cancellation |
| VS Code activation | Passed in isolated VS Code 1.96.4; commands, sample panel and SQL editor |
| VSIX | Manifest, archived runtime hashes and Oracle license/notice entries verified before upload |
| Live Oracle | Not run: no working Docker engine/disposable Oracle server was available; the opt-in harness was checked and skipped by its guard |
| Live SQL Server / OpenAI | Not run; existing fixtures/protocol and mock transport coverage remain |

Oracle fixture and protocol tests are not evidence of successful execution against a real Oracle server. Oracle 19c/Free compatibility, real grants, TCPS, RAC/PDB edge cases and runtime cursor behavior require live verification. See [Oracle setup and opt-in integration](oracle-support.md).

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
