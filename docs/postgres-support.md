# PostgreSQL support

[Documentation](README.md) · [Getting started](getting-started.md)

PostgreSQL 14 and later are the compatibility target. Live integration has been verified against PostgreSQL 18.4; versions 14-17 have not been verified in this environment.

## Supported SQL

Estimated plans support common SELECT, VALUES, UNION, INSERT and WITH forms ending in SELECT or INSERT. INSERT sources may use SELECT or VALUES; supported RETURNING and ON CONFLICT forms are accepted. Only the main statement may INSERT.

The parser rejects standalone UPDATE/DELETE, data-modifying CTEs, SELECT INTO, locking SELECTs, DDL and unsupported statement types. Some valid PostgreSQL syntax is outside `pgsql-ast-parser` support; dollar-quoted expressions and INSERT DEFAULT VALUES can be rejected. Validation fails before collection when a statement cannot be classified.

Selections are authoritative; with no selection, the whole file is used. Up to 20 semicolon-delimited statements are processed sequentially, each with its own connection and transaction. An earlier INSERT estimate does not populate data for subsequent plans. Invalid statements appear as individual errors; ambiguous or unfinished lexical input stops splitting before any request.

## Estimated plans

The host uses a fresh connection and separate protocol statements for:

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10000ms';
SHOW server_version;
EXPLAIN (FORMAT JSON, VERBOSE TRUE, COSTS TRUE) <validated statement>;
ROLLBACK;
```

This path does not enable ANALYZE or execute the statement to collect results. PostgreSQL planning can still evaluate functions, so use a least-privilege role. Connection establishment is limited to 5 seconds and the client query timeout is 12 seconds. Cancellation closes the client.

## Actual plans

A separate, confirmed run uses EXPLAIN ANALYZE with BUFFERS, JSON, VERBOSE and COSTS in an explicit transaction. It sets a 30-second statement timeout and 5-second lock timeout, commits on success and attempts rollback on failure. The client timeout is 35 seconds.

Successful INSERTs persist. A disconnect, cancellation or plan-processing failure does not guarantee that data remains unchanged. See [actual execution](getting-started.md#collect-an-actual-plan).

Actual Rows and timing metrics are per loop. Loops remain explicit; costs remain estimates. Native attributes retain buffers, warnings and other available details. Client elapsed time includes connection/network overhead and is distinct from operator timing.

## Native mapping and connections

Mappings cover scans, index/bitmap access, joins, hashing, sorting, aggregation, limits, materialization, parallel gathers and append operators. Unknown operators use OTHER and preserve their native name and attributes. ModifyTable INSERT operations display an Insert label while retaining their native type.

Connections use username/password and either verified TLS or disabled TLS for local development. TLS uses Node's certificate trust store. Custom CA/client-certificate selection and connection pooling are not implemented.

See [verification](verification.md) for live SELECT, join, estimated INSERT and actual INSERT checks.
