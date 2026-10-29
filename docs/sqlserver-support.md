# SQL Server support

[Documentation](README.md) · [Getting started](getting-started.md)

SQL Server support uses Showplan XML and the Tedious driver. Parsing, session sequencing and UI behavior have automated coverage; live SQL Server integration has not been run in this environment. A minimum server-version compatibility claim has not been established.

## Connections

Choose SQL Server when adding a connection. Provide a hostname and explicit TCP port (default 1433), database, user and password. Supported authentication modes are SQL authentication and explicit Windows domain credentials through NTLM.

Automatic Windows integrated sign-in, Entra sign-in and named-instance discovery are not implemented. For a named instance, supply its actual TCP port. TLS certificate verification is the default; trusting the server certificate is an explicit development option.

New connections suggest the dedicated username `dbtuna`. Ask the DBA for access only to the intended database, SHOWPLAN in each referenced database and the target-object permissions required to compile the selected SQL (normally SELECT for reads). Estimated INSERT needs statement permissions even without execution. Grant INSERT and any necessary trigger/dependency permissions only when confirmed writes are intended. `sa` and sysadmin membership are not required. Explicitly chosen administrator profiles remain supported.

## SQL and multiple queries

Estimated plans support SELECT, INSERT, WITH queries and DECLARE setup in the same query batch. Semicolons do not split the batch before compilation, preserving variable context. A standalone GO line, including a trailing comment, separates batches. GO repeat counts and SQLCMD controls are rejected.

Each returned statement plan appears in its own numbered visualizer section, including repeated identical statements. Imports of multi-statement `.sqlplan` files use the same separation. Limits apply to both input batches and returned statement plans; at most 20 query sections are supported.

SET, EXEC/EXECUTE, DDL, UPDATE, DELETE, dynamic execution and external-access constructs are outside the supported query subset. Scripts that create temporary tables are not executed to prepare a plan.

## Estimated collection

A dedicated connection sends these as separate batches:

```sql
SET SHOWPLAN_XML ON;
-- Selected, validated T-SQL batch
SET SHOWPLAN_XML OFF;
```

Submitted query statements are compiled for estimates, not executed. The login needs appropriate statement permissions and SHOWPLAN permission in referenced databases. Connection timeout is 5 seconds; request timeout is 10 seconds. Cleanup closes the connection even after failure, and collection never retries by executing ordinary SQL.

## Actual collection

After a live estimate, a separate confirmed run enables STATISTICS XML on a dedicated connection. Normal result rowsets are discarded, and the host collects actual Showplan documents with a 30-second request timeout.

The MVP runs one SELECT or INSERT. SELECT INTO is rejected. Needed leading, semicolon-terminated, single-variable DECLARE statements with literal initializers can be reused; unsupported setup disables Run. Earlier queries are never replayed. INSERT uses SQL Server's autocommit behavior and may fire triggers. SQL can commit even if plan identification or parsing subsequently fails.

When several actual plans are returned, the connector identifies the selected statement rather than combining unrelated statement or trigger plans. An ambiguous result produces an outcome warning instead of an automatic retry.

## Metrics and offline files

Import `.sqlplan` or `.xml` through **DBTuna: Import Execution Plan**. UTF-8 and SSMS UTF-16 files are supported. XML numeric character references in query previews are decoded exactly once; literal SQL that merely resembles an entity is preserved.

Total cost means estimated subtree cost. CPU and I/O estimates retain native optimizer units. Actual rows and executions are summed across worker threads; CPU time sums thread CPU; elapsed time is explicitly the maximum thread elapsed value. These are distinct from PostgreSQL per-loop timing. Original runtime counters and unknown attributes remain available.

Showplan XML is parsed once before statement normalization. The document-wide operator limit cannot be bypassed by splitting it into multiple statements. XML DTD/entity declarations are rejected.

An old connection-schema migration clears legacy profiles and their associated secrets once. Typed profiles persist normally afterward. See [verification](verification.md) for the isolated live-test setup.

## Disposable live tests

Run `npm run test:sqlserver:docker` with Docker running. The framework starts a pinned SQL Server 2022 Developer image on `127.0.0.1:55440`, generates a test-only sa password, creates `dbtuna_integration`, runs the live suite and removes the container/database afterward. Images stay cached; saved DBTuna profiles are never used. `npm run test:databases` includes this with PostgreSQL and Oracle; `npm run verify -- --databases` also runs the standard checks.

The shared lifecycle helper verifies ownership before cleanup and cleans up after suite/startup failures. Live coverage includes estimates that do not execute writes, actual SELECT/INSERT, independent queries, large result rowsets, failed INSERTs, mixed skipped/failed statements, and cancellation of a genuinely blocked INSERT with server-request cleanup. SQL Server can return a statement without graphical operators for constant-only SQL such as SELECT 1; the parser reports this explicitly rather than inventing a graph.
