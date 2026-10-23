# Getting started

[Documentation](README.md) · [Troubleshooting](troubleshooting.md)

## Install

Use VS Code 1.96 or later. Download a `.vsix` from [Releases](https://github.com/YoeriBoerema/DBTuna/releases/latest), then run **Extensions: Install from VSIX...** in the Command Palette. Run **Developer: Reload Window** after updating if the old controls remain visible.

Run **DBTuna: Load Sample Plan** for an offline demonstration. To use the latest main-branch source before a release is published, follow the [development guide](development.md).

## Add a connection

1. Open a trusted workspace.
2. Run **DBTuna: Add Connection**.
3. Choose PostgreSQL or SQL Server and enter the host, explicit TCP port, database, user and TLS preference.
4. Enter the password; it is saved in VS Code SecretStorage.
5. Run **DBTuna: Manage Connections**, select the profile, then choose **Test Connection**.

Use **DBTuna: Select Connection** to switch profiles. Manage Connections also supports updates and removal. Editing a profile requires re-entering its password. SQL Server additionally offers explicit NTLM domain credentials; see its [connection guide](sqlserver-support.md).

## Explain SQL

Click the SQL editor before invoking **DBTuna: Explain Query**. The command is available through the Command Palette, the context menu in supported SQL editors, and the editor's graph action. It is not part of VS Code's generic Run menu.

- With a selection, only that exact text is considered.
- Without a selection, the entire file is considered; the caret does not choose a statement.
- Whitespace-only selections are rejected rather than falling back to the file.
- Logs around SQL are not stripped. Select the SQL itself.

PostgreSQL splits statements at semicolons outside strings, identifiers and comments, then validates each statement. Successfully parsed but unsupported statements (such as SET, DDL and transaction control) appear as **Skipped**, with a reason and a skipped count. Invalid or parser-unrecognized syntax remains **Failed**. Setup is never executed or replayed: queries use separate connections with DBTuna defaults, so omitted search_path/planner settings are not preserved and newly declared temporary tables are unavailable. Later independent queries continue after a failure. SQL Server compiles independent semicolon-delimited queries separately and preserves supported variable batches within GO boundaries. Each returned statement plan has its own visualization. Unsupported setup appears as **Skipped**, with a count in the summary. `SET NOCOUNT` is omitted; DDL is never executed. A query referencing a table the script would create can fail while independent queries continue. Other unsupported session changes or variable assignments skip the remaining GO batch to avoid changing its meaning. Control-flow and module definitions are skipped as a unit; select an independent query to explain it. Use semicolons between statements; standalone NOCOUNT lines also work. See the [engine guides](README.md#use-dbtuna) for supported syntax.

Each query section has an expandable SQL preview, status, estimated cost, graph and operator details. Invalid statements or collection failures appear in their own section. Cancel batch stops remaining work and retains finished plans. Off-screen graphs initialize as you scroll.

## Explore a plan

Select an operator to inspect its object, estimates, measured counters when available and native attributes. Hover for 0.5 seconds to open its cost tooltip. Optimizer cost units are not milliseconds and are not comparable across engines.

The Plan view selector switches between compact horizontal and top-down cards. Compact view places the result on the left and its inputs to the right; arrows point left to indicate data flow. Auto layout, zoom controls and the operator navigation dropdown help navigate large graphs.

## Collect an actual plan

Operator details also include [local plan analysis](local-analysis.md), with evidence-backed rules for PostgreSQL and SQL Server. No API key is needed. Actual plans enable more checks than estimates alone; use **Show whole query** to inspect findings from other operators.

After a live Explain, an eligible SELECT or INSERT offers **Run query and collect actual plan**. Click once to change the button to **Are you sure?**, then click again to execute the displayed query on its original connection. Each run requires both clicks.

**A successful INSERT run commits changes and may fire triggers. Repeating Run repeats its effects. SELECT functions also execute. Cancellation cannot guarantee that changes are undone.**

The run targets the chosen statement. SQL Server may include required leading literal DECLARE statements, but earlier queries are not replayed. Execution is limited to approximately 30 seconds per statement; PostgreSQL also has a 5-second lock timeout. There are no automatic retries.

On success, use the Estimated and Actual tabs. Actual details include measured rows, loops/executions and available timings. Failed or cancelled runs keep the estimate and any previous actual plan. If SQL ran but plan collection failed, check the database before retrying a write. There is no query results grid or live partial-plan display.

Execution requires a current live estimate on its original, unchanged connection. Imported plans and restored view snapshots do not authorize runs. Generate a fresh Explain after reloading or changing a connection.

## Import and export

Run **DBTuna: Import Execution Plan** from the Command Palette. It accepts raw PostgreSQL JSON, SQL Server `.sqlplan`/`.xml` including SSMS UTF-16, canonical DBTuna JSON and DBTuna batch envelopes. No connection or SQL execution is required.

Run **DBTuna: Export Execution Plan** to save the loaded single plan or estimated batch, including SQL text, statuses, errors and native attributes when present. The single-plan Export button is also available. Import and batch export are Command Palette actions; the removed toolbar buttons are not required.

Actual-run results are session-local and there is currently no Export actual plan button. On the Actual tab, AI advice uses the actual plan. Review exported query text and native attributes before sharing files.

## Commands

All commands below are available in the Command Palette with the `DBTuna:` prefix.

| Command | Purpose |
| --- | --- |
| Explain Query | Collect estimated plans from the active editor |
| Add Connection | Create a typed database profile |
| Select Connection | Choose the active profile |
| Manage Connections | Test, update or remove a profile |
| Load Sample Plan | Open an offline sample |
| Import Execution Plan | Open a plan or saved batch |
| Export Execution Plan | Save the loaded plan or estimated batch |
| AI Assistance | Open the AI settings menu |
| AI Assistance: Set API Key | Save an OpenAI API key |
| AI Assistance: Select Model | List account models or enter a model ID |
| AI Assistance: Remove API Key | Delete the stored key |
