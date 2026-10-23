# DBTuna

Explore PostgreSQL, SQL Server and Oracle execution plans beside your SQL in VS Code.

Inspect estimated plans, collect actual plans after confirmation, and get optional AI optimization advice for the selected operator.

[Get a release](https://github.com/YoeriBoerema/DBTuna/releases/latest) · [Quick start](docs/getting-started.md) · [Documentation](docs/README.md) · [Development](docs/development.md) · [Changes](CHANGELOG.md)

![DBTuna query plan with operator details](media/screenshot.png)

## What you can do

| Feature | Behavior |
| --- | --- |
| Estimated plans | Explain selected SQL, or the whole file when nothing is selected. |
| Multiple queries | Inspect each returned statement in its own numbered section, with independent selection and errors. |
| Actual plans | Run an eligible SELECT or INSERT after confirmation, then switch between Estimated and Actual. |
| Operator details | Inspect rows, costs, timings and native attributes. Cost tooltips appear after 0.5 seconds. |
| Two graph views | Choose compact horizontal or top-down cards, with pan, zoom and operator navigation. |
| Offline inspection | Import PostgreSQL JSON, SQL Server Showplan XML, Oracle native JSON/DBMS_XPLAN text or DBTuna JSON through the Command Palette. |
| AI assistance | Supply an OpenAI API key and model, then explicitly request a score, short suggestions and proposed SQL. |

**Explain Query collects estimates. Run query executes SQL. Successful INSERT runs commit changes.** See [actual execution](docs/getting-started.md#collect-an-actual-plan) before running writes.

## Install and try it

1. Download the `.vsix` asset from [GitHub Releases](https://github.com/YoeriBoerema/DBTuna/releases/latest).
2. In VS Code, open the Command Palette and run **Extensions: Install from VSIX...**.
3. Run **DBTuna: Load Sample Plan** to explore without a database connection.
4. For live plans, open a trusted workspace and run **DBTuna: Add Connection**.
5. Select SQL in an editor, then run **DBTuna: Explain Query** from the Command Palette or editor context menu.

The source version is in [generated build information](docs/build-info.md); the latest published release is **v0.7.3**. See [development and packaging](docs/development.md). VS Code 1.96 or later is required.

Oracle Database is new in **0.7.0 - The Oracle Has Arrived!** It supports estimated plans, confirmed actual SELECT/INSERT, query batches, local analysis, AI assistance and plan imports. See the [Oracle guide](docs/oracle-support.md) for service-name setup, permissions and testing limits.

## Database support

| | PostgreSQL | SQL Server | Oracle Database |
| --- | --- | --- | --- |
| Estimated plan format | EXPLAIN JSON | SHOWPLAN_XML | EXPLAIN PLAN / structured PLAN_TABLE rows |
| Actual plan collection | EXPLAIN ANALYZE with buffers | STATISTICS XML | Instrumented, uniquely tagged SQL_ID/child cursor |
| Query grouping | Semicolon-delimited statements | Semicolon queries and GO batches | Oracle semicolons, quoting and SQL*Plus slash boundaries |
| Authentication | Username/password | SQL authentication or explicit NTLM credentials | Thin username/password, service/PDB, optional TCPS |
| Verification | Live PostgreSQL 18.4 integration | Live disposable SQL Server 2022 integration; other configurations remain opt-in | Fixtures, collector and browser checks; live tests opt-in |

Common SELECT and INSERT forms are supported. Supported syntax differs by engine; UPDATE, DELETE, DDL and dynamic execution are outside the current scope. Read the [Oracle](docs/oracle-support.md), [PostgreSQL](docs/postgres-support.md) and [SQL Server](docs/sqlserver-support.md) guides for exact boundaries.

## Privacy and execution

Database passwords and the OpenAI API key stay in VS Code SecretStorage. Database operations run in the extension host; no standalone backend is required. Imported plans need no connection.

AI assistance is optional. Clicking **Get AI advice** sends the displayed query, normalized plan, operator and context to OpenAI. SQL literals and object names are included; credentials and connection labels are excluded. Advice never executes SQL. Details: [AI assistance](docs/ai-assistance.md) and [security](docs/security.md).

## Documentation

- [Getting started](docs/getting-started.md): connections, query selection, actual execution, import/export and commands.
- [Troubleshooting](docs/troubleshooting.md): missing commands, disabled Run actions, parsing and connection problems.
- [Architecture](docs/architecture.md): canonical plans, connectors, host services and UI state.
- [Adding a connector](docs/adapter-development.md): extend database support without changing the graph renderer.
- [Verification](docs/verification.md): reproducible checks and known testing gaps.

## Develop

```sh
npm install
npx playwright install chromium
npm run verify
npm run package
```

Development requires Node.js 22 or later. `npm run verify` runs type checks, lint, unit tests, both builds and all browser suites. Additional integration checks, screenshot generation and packaging instructions are in the [development guide](docs/development.md).

## License

DBTuna's original project code and materials on the current branch use the [DBTuna Non-Commercial, No-Resale License](LICENSE). Non-commercial use, modification and free sharing are permitted. Commercial use, including internal commercial business use, and sale or resale are prohibited without a separate written license from the copyright holders. These restrictions also cover modified versions and substantial portions incorporated into other products.

Third-party components retain their own licenses. Previously released MIT versions, including v0.7.1 and earlier, retain their original permissions; this change does not retroactively restrict those copies. This is a source-available license with commercial restrictions, not an open-source license.

## Database Explorer

Open **Explorer** in VS Code and expand **DBTuna Database Explorer**. Expand a saved connection to browse schemas and tables, then expand a table for columns, primary keys, foreign keys, unique constraints and indexes. Hover over an item for its native type or definition. Use the view’s **Add Connection** and **Refresh Database Explorer** actions to manage connections and reload metadata. Refresh also cancels outstanding metadata reads.

Folders load on demand and cache results in memory until refresh, connection changes or extension restart. Browsing reads database catalogs only and requires a trusted workspace. Database permissions limit what is visible; an empty folder does not prove an object is absent. Connections remain scoped to their configured database or Oracle service/PDB.

This first version focuses on ordinary tables. Views, partition details, synonyms and other specialized objects are outside its scope. Native types and definitions remain engine-specific text; this is a browsing model, not a schema migration or type-conversion system. Oracle column defaults and function-based index expressions are not expanded. A folder containing more than 2,000 entries reports a limit rather than silently showing a partial result. SQL Server metadata browsing uses STRING_AGG and requires SQL Server 2017 or later.
