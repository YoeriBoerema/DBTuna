# Troubleshooting

[Documentation](README.md) · [Getting started](getting-started.md)

## Explain Query is missing

DBTuna uses its own **DBTuna: Explain Query** command, not VS Code's generic Run menu. Open the Command Palette, search for that exact command and click your SQL editor before invoking it. SQL context-menu and editor-title actions appear for supported SQL language modes or `.sql` files; the Command Palette can also be used from a text file.

If the extension was just updated, run **Developer: Reload Window**. Confirm that DBTuna is enabled and that the workspace is trusted for live database work.

## The Run query button is disabled

Run a fresh Explain on a live connection. Imported plans and restored snapshots do not authorize execution. A changed connection requires another Explain. Hover the disabled button for the reason.

The actual-plan MVP accepts supported single SELECT/INSERT statements. SQL Server SELECT INTO and complex variable setup are rejected; only required leading literal DECLARE statements can be reused.

## Unsupported or incomplete PostgreSQL syntax

Select only complete SQL, without surrounding log messages. A whitespace-only selection is rejected; no selection uses the entire file. A valid native PostgreSQL statement can still exceed the AST parser's supported syntax. See [PostgreSQL support](postgres-support.md).

## Several SQL Server queries need separate graphs

Separate query statements normally with semicolons. DBTuna compiles each GO-delimited batch together for variable context, then gives each returned statement its own query section. Use a standalone GO line only when you intend a separate compilation batch. GO repetition counts are unsupported.

## SQL previews show XML entities

Numeric Showplan references such as encoded CR/LF line endings are decoded by the current parser. Update DBTuna, reload the window and generate a fresh Explain. Older published versions or previously saved raw data may not include all current fixes; compare the installed version with the [source and release information](../README.md#install-and-try-it).

## Connection testing succeeds but Explain fails

Connection testing establishes connectivity using a simple query. It does not prove planning permissions or support for the selected SQL. For SQL Server, check SHOWPLAN permission in each referenced database and use the actual TCP port for named instances. For PostgreSQL, review statement permissions and parser compatibility.

TLS verification uses the driver's/Node's trust configuration. A self-signed development certificate can require explicit SQL Server certificate trust; PostgreSQL does not offer an insecure certificate bypass. Avoid changing TLS settings to diagnose an unrelated syntax or permission error.

## An actual run failed or was cancelled

Keep the error message and check whether the database changed before retrying a write. SQL can commit before actual-plan collection or parsing finishes. Cancellation closes the connection but cannot guarantee rollback or undo external effects. Existing estimates and previous successful actual plans remain visible.

## AI reports an error

Check the saved API key, account API quota and chosen model's support for Responses structured outputs. A model's presence in the account list is not an endpoint-compatibility guarantee. Large plans can exceed the 512 KiB input limit; invalid or incomplete responses are rejected. See [AI assistance](ai-assistance.md).

When reporting a problem, include the DBTuna/VS Code versions, database type, action and sanitized error. Review SQL literals, hostnames and native plan attributes before attaching examples. Never include passwords or API keys.
