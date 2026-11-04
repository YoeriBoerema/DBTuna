# Development

[Documentation](README.md) · [Architecture](architecture.md) · [Verification](verification.md)

## Set up a checkout

Use Node.js 22 or later, pnpm 11.25.0 and Git. VS Code 1.96 or later is the extension target. Clone the repository with a GitHub account that has access, then work from its root:

```sh
git clone https://github.com/YoeriBoerema/DBTuna.git
cd DBTuna
pnpm install --frozen-lockfile
npx playwright install chromium
npm run verify
```

pnpm is the canonical release installer; use the committed lockfile with --frozen-lockfile. npm may run scripts, but npm install does not reproduce the reviewed pnpm dependency tree. Dependencies are bundled into the VSIX; users installing the extension do not need Node.js or node_modules.

`DBTUNA_BROWSER` can point to an installed Chromium-family executable instead of Playwright's downloaded browser. For example, in Windows PowerShell:

```powershell
$env:DBTUNA_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run verify
```

## Run and package

Open the repository root in VS Code and press F5. The configured build task launches an Extension Development Host. Run DBTuna commands in that window.

For an installable artifact:

```sh
npm run package
```

The package filename is derived from `package.json`; see the generated [build information](build-info.md). Packaging builds first, checks the archived manifest and compares runtime entry points with the fresh bundles. In VS Code, run **Extensions: Install from VSIX...** to install it, then **Developer: Reload Window**. Source version and published GitHub release version can differ; building does not publish a release.

## Verify

| Command                                 | Coverage                                                                                                          |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `npm run verify`                        | Generated build information, formatting, TypeScript, lint, unit tests, host/webview builds and all browser suites |
| `npm run verify -- --postgres --vscode` | The above plus disposable PostgreSQL integration and VS Code activation                                           |
| `npm test`                              | Unit tests                                                                                                        |
| `npm run test:browser`                  | Browser suites against existing dist bundles                                                                      |
| `npm run test:postgres:docker`          | Create, test and remove a temporary PostgreSQL container                                                          |
| `npm run test:sqlserver:docker`         | Create, test and remove a temporary SQL Server Developer container                                                |
| `npm run test:oracle:docker`            | Create, test and remove a temporary Oracle Free container                                                         |
| `npm run test:databases`                | PostgreSQL, SQL Server and Oracle live integration, sequentially                                                  |
| `npm run test:databases:up`             | Deploy all three test databases and leave them running                                                            |
| `npm run test:databases:run`            | Run integration suites against this checkout's deployed databases                                                 |
| `npm run test:databases:down`           | Remove only this checkout's deployed test containers and their anonymous volumes                                  |
| `npm run verify -- --databases`         | Full verification plus all three disposable databases                                                             |
| `npm run test:vscode`                   | Extension activation and registered-command smoke check                                                           |
| `npm run screenshots`                   | Explicitly regenerate screenshots against existing dist bundles                                                   |

Normal verification does not update tracked screenshots. Build first before running standalone browser or screenshot commands. Browser fixtures and generated previews live under ignored `work/`.

The VS Code test runner can obtain a compatible executable, or `VSCODE_EXECUTABLE` can point to an existing one. It uses a separate test user-data directory. Integration tests must target disposable databases; they never consume saved DBTuna connection profiles.

## Keep all test databases running

From the repository root with Docker Desktop running:

```sh
npm run test:databases:up
```

This creates fresh PostgreSQL, SQL Server and Oracle containers, waits for readiness, and prepares their isolated test databases and Oracle grants. It leaves all three running. Ports are bound to `127.0.0.1`: PostgreSQL **55439**, SQL Server **55440**, Oracle **55441**. The first deployment may download several gigabytes. Each container has a 3 GB memory limit, so allow capacity for all three (up to 9 GB total), unlike the sequential disposable runner. SQL Server uses its Developer testing license with `ACCEPT_EULA=Y`.

Run integration tests against this deployment:

```sh
npm run test:databases:run
```

Clean up its containers and anonymous data volumes:

```sh
npm run test:databases:down
```

Cleanup checks the exact ownership labels recorded for this checkout and does not prune Docker or remove other containers/images. Repeating `down` is harmless. Repeating `up` while a deployment exists is refused; clean up first to create fresh databases. If startup fails, containers created by that attempt are rolled back. If cleanup cannot complete, state is retained so `down` can retry. After an interrupted startup, use `down` before deploying again. Concurrent lifecycle commands for the same checkout are locked.

Generated test passwords and connection details are stored in ignored `work/test-databases.json` with restrictive file creation permissions where the OS supports them. Keep this file private; it is never printed or committed. Do not delete it while the databases exist, because it records the ownership needed for cleanup. All `run` targets are validated for ownership, pinned image, running state and localhost port mapping before any integration suite starts.

The existing `npm run test:databases` still creates and removes temporary databases sequentially. Use it when no persistent deployment is running; it uses the same ports. `npm run verify` runs normal checks without live databases; combine it with `test:databases:run` when using the persistent deployment.

## Database integration

The PostgreSQL Docker runner starts a pinned PostgreSQL 18.4 image on `127.0.0.1:55439`, creates a fresh `dbtuna_integration` database with generated credentials and removes its container/data afterward. The embedded runner and dependency have been removed. See the [verification guide](verification.md) for tested behavior.

Run all database tests with Docker running:

```sh
npm run test:databases
```

All three engines use temporary Docker containers. Individual commands are `npm run test:postgres:docker`, `npm run test:sqlserver:docker` and `npm run test:oracle:docker`. Full checks can include the databases with `npm run verify -- --databases`; `--sqlserver`, `--oracle` and `--postgres` select integrations individually. Database runners execute sequentially to limit memory use and stop on failure.

The Docker runners use pinned image digests, generated passwords, unique names and localhost-only ports (PostgreSQL 55439, SQL Server 55440, Oracle 55441). They create fresh test databases/users, wait for readiness, run real estimated/actual plan tests, then remove their owned containers and anonymous volumes in finally, including on startup or suite failure. Ownership labels prevent unrelated container removal. They never mount host data, reuse saved profiles, log credentials or prune other Docker resources. Images remain cached; the first run may download several gigabytes. Allow about 3 GB RAM for one container. SQL Server uses the official Linux x86-64 Developer image with `ACCEPT_EULA=Y` for development/testing; Oracle uses Oracle Free.

For an already provisioned **disposable** server at `127.0.0.1:55440` with database `dbtuna_integration`, the lower-level SQL Server test remains available:

```powershell
$env:DBTUNA_SQLSERVER_TEST = '1'
$env:DBTUNA_SQLSERVER_TEST_PASSWORD = '<test-only-password>'
npm run test:sqlserver
```

The SQL Server test creates/drops a uniquely named table and verifies estimated plans without writes, actual SELECT/INSERT, separate query sections, large results, failed writes, mixed batches and server-side cancellation. Constant-only SELECT may have no graphical operators; that limitation is tested explicitly. `npm run test:postgres` now runs only the PostgreSQL integration file, rather than every engine's tests. Never supply production credentials.

AI tests use mock transport. A live OpenAI request requires a separately supplied, dedicated test key and explicit authorization; ordinary verification never sends SQL to OpenAI.

## Changing database support

Native parsers belong in adapter packages; live database behavior belongs behind the host connector contract. Keep the two-click confirmation in the execution controls and execution authorization in the host. See [adding a connector](adapter-development.md) and [security](security.md) before modifying collection or execution paths.

`npm run format:check` checks formatting without edits. `npm run format` applies it. After changing the version, run `npm run docs:versions`; packaging also refreshes the generated build information.

For a manually provisioned disposable PostgreSQL database, `npm run test:postgres` requires `DBTUNA_POSTGRES_TEST=1` and `DBTUNA_POSTGRES_TEST_PASSWORD`; host/port/user/database are fixed to `127.0.0.1:55439`, `dbtuna`, `dbtuna_integration`. Normal integration runs never rewrite tracked PostgreSQL fixtures. To deliberately refresh them, set `DBTUNA_UPDATE_POSTGRES_FIXTURES=1` before invoking the PostgreSQL Docker runner.

### Shared metadata sample

After `npm run test:databases:up`, run `npm run test:databases:seed` to populate all three managed databases with the same deterministic metadata catalog. Refresh the DBTuna Database Explorer and expand `dbtuna_sample` (`DBTUNA_SAMPLE` on Oracle). Use your existing test connection; Oracle grants access to the sample objects to `dbtuna_integration`.

| Table                  | Rows |
| ---------------------- | ---: |
| owners                 |  100 |
| data_systems           |  100 |
| data_schemas           |  120 |
| data_tables            |  150 |
| data_columns           |  250 |
| classifications        |  100 |
| tags                   |  100 |
| table_tags             |  200 |
| column_classifications |  200 |
| data_lineage           |  200 |

Each database contains 1,520 rows, 10 primary keys, 15 foreign keys, composite association keys and an owner hierarchy. Identifiers and values match across engines; native integer/text types and Oracle identifier case differ. Dates use fixed calendar values. A portable starting query is:

```sql
SELECT * FROM dbtuna_sample.data_tables ORDER BY table_id;
```

The fixture in `test/fixtures/sampleMetadata.mjs` defines all engines' data and structure. Seeding checks the managed container identities, pinned images and localhost bindings, then verifies the columns, keys, constraints and every row. It writes counts and SHA-256 hashes (no passwords) to ignored `work/sample-data-report.json`. An unchanged sample is verified and retained on rerun. An existing modified sample namespace is never overwritten; if you want a fresh deployment, `test:databases:down` removes all managed test data before `test:databases:up` and `test:databases:seed` recreate it. Seeding commits per engine, so a failure can leave earlier engines populated; rerun after fixing the failure.

Oracle uses a schema-only `DBTUNA_SAMPLE` owner without a login; continue connecting with the app user. Manual row edits are allowed, but subsequent seed verification will report mismatches.
