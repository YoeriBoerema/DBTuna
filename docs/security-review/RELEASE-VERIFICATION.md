# DBTuna 0.8.1 security remediation verification

Verified on 29 October 2026, Windows, Node.js 24.22.1 and pnpm 11.25.0.

| Check | Result |
| --- | --- |
| Generated version information, formatting, TypeScript and ESLint | Passed |
| Unit tests | 150 passed; zero failed/skipped |
| Browser suites | All 11 passed in headless Microsoft Edge |
| PostgreSQL live integration | Passed on disposable PostgreSQL 18.4; estimates, actual SELECT/INSERT, persistence, rollback, cancellation and catalog reads |
| SQL Server live integration | All 7 checks passed on disposable SQL Server 2022, build 16.0.4275.2; includes blocked-INSERT cancellation and supported SQL authentication |
| Oracle live integration | All 7 checks passed on disposable Oracle Free 23.26.3.0.0; includes privilege preflight, failed writes, cancellation and LOB cleanup |
| VS Code host smoke test | Passed in an isolated downloaded VS Code 1.96.4, including new-connection username defaults for all three engines; no credentials saved |
| Dependency audit | Zero known vulnerabilities in the refreshed full dependency tree |

The installed VS Code executable was blocked by an existing update mutex. The isolated 1.96.4 build completed the activation, command, sample-plan, SQL-editor and wizard tests successfully. Incidental VS Code/native-module and SQL Server IP/SNI deprecation warnings did not fail tests.

The SEC-001 tests verify no credentials are read and no collector runs while host approval is pending. Rejection, cancellation, plan replacement, altered SQL, connection changes, trust changes and asynchronous credential races prevent execution. Both SELECT and INSERT require fresh host approval; duplicate/concurrent messages cannot repeat a run.

The SEC-002 tests exercise the actual pinned PostgreSQL driver over both plaintext and verified TLS using local fake protocol peers. A declared 1 GiB response frame is rejected after just its header, without allocating/sending its body. Split/coalesced frames, cumulative response limits, object inputs, aggregate strings, key sizes, UTF-8, escaping and lone-surrogate accounting are covered. This establishes bounded protocol input; it is not a benchmark of every driver memory allocation.

The SEC-003 tests inject sentinel secrets into native messages, details, hints and causes and verify safe diagnostics, execution messages and serialized batches exclude them. Imported historical error text is discarded. Permission/authentication/timeout guidance and uncertain-write warnings remain controlled application messages. Cancellation diagnostics were corrected after the first SQL Server integration run and the complete affected suite passed on rerun.

SEC-004 is checked through the actual connection wizard in the isolated VS Code host: PostgreSQL, SQL Server and Oracle suggest `dbtuna`, and each test cancels before asking for a password or saving a profile.

All live database tests used the repository's uniquely owned disposable Docker containers, localhost ports and generated test credentials. Containers/data were removed after each run. No production/saved connection or live OpenAI API key was used.

Dependency remediation upgrades MSAL Node to 7.1.0 through a documented override and fast-uri to 3.1.9. DBTuna does not expose the affected Azure authorization-code flow. SQL/password integration passed; enterprise NTLM, live Azure authentication, Oracle TCPS/wallets and other server versions remain outside this validation. A clean advisory scan does not prove absence of undisclosed vulnerabilities.

Release packaging uses `node scripts/package.mjs`, which rebuilds the extension and verifies the archived manifest, runtime bundle hashes and Oracle notices. The release uploads the resulting VSIX and its SHA-256 checksum. Package/upload integrity is verified separately during publication.
