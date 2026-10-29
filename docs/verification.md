# Verification

[Documentation](README.md) · [Development](development.md)

## 0.8.1 security release verification — 29 October 2026

All 150 unit tests, all eleven headless Edge browser suites, formatting, TypeScript, lint and builds passed. Live disposable PostgreSQL 18.4, SQL Server 2022 and Oracle Free integration suites passed. The isolated VS Code 1.96.4 host test passed, including new-connection defaults for all three engines. The refreshed dependency audit reports zero known vulnerabilities. See the [security remediation verification](security-review/RELEASE-VERIFICATION.md) for evidence, reproduction details and remaining limits.

## 0.8.0 release verification — 24 October 2026

- Formatting, TypeScript and ESLint passed.
- All 133 unit tests passed, including database-wide metadata aggregation, cross-schema/composite keys, measured schema separation, column anchors, obstacle-aware routing and cancellation.
- All ten headless Edge browser suites passed, including database diagram drag/reroute behavior, matching colors/arrowheads, redundant schema line patterns, deuteranopia simulation and reference light/dark contrast checks.
- Packaging verifies the manifest and archived runtime bundle hashes, including the relationship viewer JavaScript and CSS.
- The isolated VS Code activation test could not start because the installed VS Code reports an update mutex is held. This is an environment block, not a passing host test.
- Live database integration tests were not rerun for this release; catalog permissions and engine/version differences still require live validation.

Earlier database and host verification is recorded below.

Verification recorded **23 October 2026** for **0.7.1** Source version: [build information](build-info.md). Results describe this development environment, not a guarantee across every database/version.

## Release checks

| Check | Result and scope |
| --- | --- |
| Unit tests | 120 passed, including Oracle lexical boundaries, adapters, analysis, collector protocol, commit/rollback, cancellation, LOB cleanup and bundled Thin driver transport |
| Formatting, TypeScript and ESLint | Passed |
| Host and webview | Built successfully; Oracle driver and notices are bundled |
| Browser suites | All nine passed in isolated headless Edge, including Oracle query sections, inline execution confirmation, actual/estimated switching and finding navigation |
| PostgreSQL integration | Passed on disposable Docker PostgreSQL 18.4, including unchanged estimate row counts, SELECT/INSERT actual plans, committed INSERT, rollback and cancellation |
| VS Code activation | Passed in isolated VS Code 1.96.4; commands, sample panel and SQL editor |
| VSIX | Manifest, archived runtime hashes and Oracle license/notice entries verified before upload |
| Live Oracle | Post-release Docker run: all seven checks passed on Oracle Free 23.26.3.0.0; see below |
| Live SQL Server | Post-release disposable Docker suite passed on SQL Server 2022, build 16.0.4275.2 |
| Live OpenAI | Not run; mock transport coverage remains |

Oracle Free 23.26.3 runtime behavior and restricted-grant paths are now live-tested. Oracle 19c, TCPS/wallets and RAC/PDB edge cases still require verification. See [Oracle setup and Docker integration](oracle-support.md).

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

`npm run test:postgres:docker` creates and removes a PostgreSQL 18.4 container and fresh database on localhost port 55439 with generated credentials. It does not use saved extension connections or host data mounts. All three engines now use the same Docker lifecycle helper; the former embedded runner has been removed.

For SQL Server, provision a disposable instance at `127.0.0.1:55440` with database `dbtuna_integration`, set `DBTUNA_SQLSERVER_TEST=1` and `DBTUNA_SQLSERVER_TEST_PASSWORD`, then run:

```sh
node --import tsx --test test/integration/sqlserver.test.ts
```

This opt-in test creates/drops a uniquely named table and verifies estimated and actual SELECT/INSERT behavior. It performs writes. See [development](development.md#database-integration) for PowerShell setup.

## Remaining gaps

- PostgreSQL 14-17 compatibility is a target, not verified here.
- SQL Server 2022 username/password, development TLS and actual execution are live-tested; NTLM, certificate verification and other server versions remain unverified.
- OpenAI account/model compatibility and live API responses were not tested with a real key.
- Connection/setup dialogs, all real VS Code themes, assistive technologies and a full manual editor-to-database walkthrough need further coverage.
- Native SQL parser support is intentionally narrower than each database's full grammar.
- Browser timing observations are smoke checks, not performance guarantees.

Older checkpoints are in the [verification history](archive/verification-history.md). They preserve historical counts and behavior and should not be used as current instructions.

Refactor regressions also cover snapshot identity across serialization and execution-availability changes, explicit confirmation/display transitions, connector classification, all conversion warnings with provenance, per-rule applicability reasons and version-derived artifact naming. Tests are grouped by behavior and share native fixture builders. The PostgreSQL integration expectation for an unsupported DELETE was refreshed from Failed to Skipped to match the existing tolerant Explain behavior.

## Post-release Oracle live verification

With Docker available, the isolated Oracle Free **23.26.3.0.0** suite passed all seven checks. It verifies estimates do not execute INSERT, actual SELECT/INSERT and concurrent cursor collection, 2,051 rows fetched over multiple chunks, sorts/joins/CTEs/alternative quotes, LOB closure, failed INSERT without commit, rolled-back diagnostic rows, mixed batches, in-flight INSERT cancellation with released locks, and missing cursor privileges before business execution while estimates still work.

`npm run test:oracle:docker` provisions and removes the dedicated localhost test container automatically. Its database/image settings and grants are in `test/integration/oracle-docker.mjs`. The image digest is pinned. Generated passwords stay in process/container memory and are not logged or saved in profiles. An additional unit regression uses the captured real Oracle plan, bringing the unit total to 117.

## Disposable multi-engine framework

`npm run test:databases` now runs PostgreSQL, SQL Server and Oracle sequentially. The complete command passed with PostgreSQL 18.4, SQL Server 2022 **16.0.4275.2** and Oracle Free **23.26.3.0.0**. SQL Server and Oracle each passed seven live checks. Containers/databases were removed after the run.

SQL Server coverage includes estimates without INSERT execution, actual SELECT/committed INSERT, three independent query sections, 2,050 result rows discarded while collecting counters, failed INSERT, mixed setup/errors, explicit operator-free constant-query handling and cancellation of a blocked INSERT confirmed through server request state. It uses only a fresh test database and generated sa credentials.

Three unit regressions verify Docker lifecycle isolation, cleanup after suite/startup/readiness failures, ownership guards and pinned images. The unit total is now 120. See [development](development.md#database-integration) for standalone commands and `npm run verify -- --databases` integration. Ordinary verification keeps Docker opt-in.

## Uniform Docker database runners

PostgreSQL has also moved to Docker. `npm run test:postgres:docker`, `npm run verify -- --postgres` and `npm run test:databases` all use its pinned PostgreSQL 18.4 image. The all-Docker aggregate passed on PostgreSQL 18.4, SQL Server 16.0.4275.2 and Oracle Free 23.26.3.0.0, creating/testing/removing three containers sequentially. All 120 unit tests and the build also passed after removing the embedded dependency. PostgreSQL requires the same explicit opt-in and generated password pattern as the other engines, and normal tests leave captured fixtures unchanged. The embedded runner, platform binaries and embedded-postgres dependency are no longer required.
