# Oracle Database

Oracle support arrived in **0.7.0 — The Oracle Has Arrived!**

## Connect

Choose **Oracle Database** in **DBTuna: Add Connection**. Enter host, TCP port (normally 1521), **service name/PDB**, username and password. This field is a service name, not a SID. An optional current schema controls unqualified object resolution. Existing PostgreSQL and SQL Server connections are preserved.

The bundled node-oracledb 6.10 driver uses Thin mode; Oracle Instant Client is unnecessary. The initial compatibility targets are Oracle 19c and Oracle Free. Oracle Free 23.26.3 has now passed live Docker integration; Oracle 19c remains a compatibility target rather than a verified version. SID descriptors, Thick mode and external/enterprise authentication are outside this release.

Verified TLS uses TCPS and server-name matching. One-way TCPS can use system trust; an optional wallet directory must contain an unencrypted `ewallet.pem` suitable for Thin mode. Encrypted wallets and wallet-password setup are not offered in this release. Use **Disable TLS** only for an appropriate local development connection. Passwords stay in VS Code SecretStorage; wallet files are managed on your machine.

## Explain and batches

Select SQL to explain that exact text; with no selection DBTuna processes the file. Each statement receives its own query section. Oracle SELECT, WITH … SELECT, INSERT VALUES and INSERT SELECT are eligible, including the Oracle `INSERT INTO … WITH … SELECT` form. Oracle itself validates compilation. Bind parameters require literal values in this release; DBTuna never guesses them.

The lexer understands comments, hints, quoted identifiers, doubled quotes and alternative quotes such as `q'[text;]'`. Semicolons split SQL statements. A standalone SQL*Plus `/` is a client delimiter and does not execute the previous statement again.

PL/SQL blocks, WITH FUNCTION/PROCEDURE declarations and stored-program definitions are skipped as complete units through their standalone slash, or conservatively through EOF when no slash is present. Inner queries are not extracted. Setup, DDL and SQL*Plus commands are not executed. Session/schema changes and script includes skip the dependent remainder rather than silently change its meaning. Independent queries following ordinary skipped DDL can continue, but references to objects the DDL would create can fail.

UPDATE, DELETE, MERGE, SELECT INTO, locking SELECT, multi-table INSERT, nested result cursors, RETURNING and dynamic execution are excluded. Limits remain 20 statements, 1 MiB selected SQL, 1,000 operators per plan and 5 MiB imported plans/batches.

Estimated collection issues `EXPLAIN PLAN` with a unique statement ID, reads structured PLAN_TABLE rows on that dedicated connection, then rolls back diagnostic writes. Explain never runs the submitted business statement. PLAN_TABLE must already be available; DBTuna does not create it. Because EXPLAIN PLAN writes diagnostic rows, it does not use PostgreSQL's read-only collection transaction.

## Actual execution

The same **Run query and collect actual plan → Are you sure?** interaction, followed by a modal VS Code confirmation, applies to Oracle SELECT and INSERT. Cancellation uses the existing two-click control. Only a current host-bound live estimate authorizes execution; imported files do not.

Before execution DBTuna checks cursor-view access and enables session row-source statistics. A unique per-run SQL comment distinguishes this run from other executions, while the preview retains the original query. SELECT rows are fetched to completion in bounded batches and discarded. The collector finds exactly one executed SQL_ID/child cursor for that tag, then reads that cursor's runtime plan. Ambiguous cursors, missing counters or evicted plans fail collection rather than display unrelated statistics.

Successful INSERT commits only after the runtime plan has been collected and validated. Errors before commit trigger rollback attempts. An error during commit has an uncertain outcome: inspect the database before retrying. Cancellation does not guarantee reversal of autonomous trigger/function effects or a commit already in progress. No execution is retried automatically.

The overall execution deadline is 30 seconds, including fetching and collection, with bounded cancellation/cleanup grace. Estimated collection has a 10-second overall deadline. Transport timeouts and driver cancellation are additional controls, not substitutes for that deadline.

## Permissions

Ask the DBA for the minimum privileges appropriate to the selected service/PDB and target objects. Estimated plans need the target SQL's compilation privileges and access to PLAN_TABLE. Actual collection additionally needs ALTER SESSION for instrumentation and SELECT on `SYS.V_$SQL` and `SYS.V_$SQL_PLAN_STATISTICS_ALL` through their public view names. DBTuna does not grant privileges or request DBA access.

For a **disposable test PDB only**, a DBA can prepare the integration user as follows. Replace the password locally; never commit it:

```sql
CREATE USER dbtuna_integration IDENTIFIED BY "replace-with-test-password";
GRANT CREATE SESSION, CREATE TABLE, ALTER SESSION TO dbtuna_integration;
ALTER USER dbtuna_integration QUOTA 50M ON users;
GRANT SELECT ON sys.v_$sql TO dbtuna_integration;
GRANT SELECT ON sys.v_$sql_plan_statistics_all TO dbtuna_integration;
```

Use Oracle's supplied PLAN_TABLE setup for the test user if the normal public plan-table facility is unavailable. Production access should be scoped by the DBA to the actual application; the test user's CREATE TABLE privilege is for test fixtures, not a DBTuna runtime requirement.

Estimated plans remain usable without cursor-view permissions. Actual attempts then fail with a setup explanation before business execution. There is no dependency on AWR, ASH, SQL Monitor or Tuning Advisor.

## Metrics and local analysis

Costs remain Oracle optimizer units. CARDINALITY maps to estimated rows; BYTES/cardinality provides a marked derived row width. Actual output rows are totals across starts. Elapsed microseconds become milliseconds, with inclusive timing clearly identified; operator/worker times are not summed. Buffer gets and physical reads remain I/O counters, never examined rows. Bounded OTHER_XML details preserve native context; XML may be truncated to 4,000 characters, and is excluded from AI payloads because it can contain peeked-bind data.

Estimated volume, sort/hash input and predicate-expression checks work before execution. Actual plans add comparable cardinality/repeated-access checks and workarea spill evidence. Parallel/adaptive row comparisons are conservatively suppressed. Filtering ratios and SQL Server-native missing-index/conversion/warning feeds have no interchangeable Oracle evidence; rule coverage explains their absence. Missing data is not zero, and no findings is not a clean bill of health.

The shared graph, 500 ms cost hover, operator details/navigation, finding highlighting, resizable panels, estimated/actual switching and optional AI advice all apply. AI receives Oracle engine/version and the selected query/plan. Advice remains optional and never executes SQL.

## Files and verification

Import canonical DBTuna JSON, the versioned `dbtuna-oracle-native` JSON envelope, or a common DBMS_XPLAN pipe table in `.txt`/`.plan` files. Text import supports Id/Operation hierarchy, names, Rows/E-Rows, A-Rows, Starts, A-Time, bytes, costs and single-line access/filter predicates. It is a compatibility reader, not a universal parser for every SQL Developer export or multiline presentation. Rounded text metrics remain approximate. Native JSON is preferred for fidelity. Exports use the existing canonical JSON commands.

The synthetic [Oracle fixture](../fixtures/oracle/sort-native.json) can be imported without a connection. Unit/collector tests and a browser suite exercise Oracle behavior. To run live integration against a **disposable localhost Oracle Free PDB mapped to port 55441**, set `DBTUNA_ORACLE_TEST=1` and `DBTUNA_ORACLE_TEST_PASSWORD`, then run `npm run test:oracle`. The host, service and username are fixed to prevent accidental tests against saved production connections. The test creates/drops a uniquely named table and commits INSERTs.

Official references: [node-oracledb installation](https://node-oracledb.readthedocs.io/en/v6.10.0/user_guide/installation.html), [Oracle EXPLAIN PLAN](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/EXPLAIN-PLAN.html), [runtime plan fields](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/V-SQL_PLAN_STATISTICS_ALL.html), [DBMS_XPLAN](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_XPLAN.html).

## Live Docker verification

After the 0.7.0 release, all seven live checks passed on Oracle Free **23.26.3.0.0**. They cover estimated SELECT/INSERT without target changes, three committed INSERT forms, complete multi-chunk SELECT fetching, concurrent cursor attribution, joins/CTEs/alternative quotes, LOB cleanup, constraint errors, mixed skipped/failed batches, in-flight INSERT cancellation with rollback and released locks, and missing cursor privileges before execution.

Run `npm run test:oracle:docker` with Docker running. The harness uses a pinned image digest, creates a uniquely named container on `127.0.0.1:55441`, generates test-only credentials without logging them, waits for health, grants test access, runs the suite and removes its container/database. No saved connections or host data mounts are used. The first run may need to download the image. The cached image is retained for later runs.

A [real actual-plan fixture](../fixtures/oracle/real-oracle-free-23.json) preserves native statistics from this isolated database. TCPS/wallets, Oracle 19c and RAC remain unverified.
