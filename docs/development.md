# Development

[Documentation](README.md) · [Architecture](architecture.md) · [Verification](verification.md)

## Set up a checkout

Use Node.js 22 or later, npm and Git. VS Code 1.96 or later is the extension target. Clone the repository with a GitHub account that has access, then work from its root:

```sh
git clone https://github.com/YoeriBoerema/DBTuna.git
cd DBTuna
npm install
npx playwright install chromium
npm run verify
```

pnpm is also supported. Dependencies are bundled into the VSIX; users installing the extension do not need Node.js or node_modules.

`DBTUNA_BROWSER` can point to an installed Chromium-family executable instead of Playwright's downloaded browser. For example, in Windows PowerShell:

```powershell
$env:DBTUNA_BROWSER = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run verify
```

## Run and package

Open the repository root in VS Code and press F5. The configured build task launches an Extension Development Host. Run DBTuna commands in that window.

For an installable artifact:

```sh
npm run build
npm run package
```

The current package command writes `../dbtuna-0.6.7.vsix`. In VS Code, run **Extensions: Install from VSIX...** to install it, then **Developer: Reload Window**. Source version and published GitHub release version can differ; building does not publish a release.

## Verify

| Command | Coverage |
| --- | --- |
| `npm run verify` | TypeScript, lint, unit tests, host/webview builds and all browser suites |
| `npm run verify -- --postgres --vscode` | The above plus disposable PostgreSQL integration and VS Code activation |
| `npm test` | Unit tests |
| `npm run test:browser` | Browser suites against existing dist bundles |
| `npm run test:embedded` | Disposable localhost PostgreSQL integration |
| `npm run test:vscode` | Extension activation and registered-command smoke check |
| `npm run screenshots` | Explicitly regenerate screenshots against existing dist bundles |

Normal verification does not update tracked screenshots. Build first before running standalone browser or screenshot commands. Browser fixtures and generated previews live under ignored `work/`.

The VS Code test runner can obtain a compatible executable, or `VSCODE_EXECUTABLE` can point to an existing one. It uses a separate test user-data directory. Integration tests must target disposable databases; they never consume saved DBTuna connection profiles.

## Database integration

The embedded PostgreSQL runner starts a localhost-only PostgreSQL instance on port 55439 with test credentials and stops it afterward. Set `DBTUNA_TEST_PORT` if needed; see the [verification guide](verification.md) for tested behavior.

SQL Server integration is explicitly opt-in. Provision a disposable server at `127.0.0.1:55440`, create database `dbtuna_integration`, and set its test-only `sa` password:

```powershell
$env:DBTUNA_SQLSERVER_TEST = '1'
$env:DBTUNA_SQLSERVER_TEST_PASSWORD = '<test-only-password>'
node --import tsx --test test/integration/sqlserver.test.ts
```

The test creates and drops a uniquely named table and executes INSERTs as part of actual-plan verification. Never supply production credentials. `npm run test:postgres` is an older script name that runs the integration test directory; SQL Server still skips unless explicitly enabled.

AI tests use mock transport. A live OpenAI request requires a separately supplied, dedicated test key and explicit authorization; ordinary verification never sends SQL to OpenAI.

## Changing database support

Native parsers belong in adapter packages; live database behavior belongs behind the host connector contract. Keep the two-click confirmation in the execution controls and execution authorization in the host. See [adding a connector](adapter-development.md) and [security](security.md) before modifying collection or execution paths.
