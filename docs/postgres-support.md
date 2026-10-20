# PostgreSQL support

Target: PostgreSQL 14 and later. Verified in this environment: PostgreSQL 18.4, with a real sequential SELECT, join EXPLAIN, invalid-column error, rejected DELETE and server-enforced read-only write rejection. Versions 14–17 are targets, not a tested compatibility claim.

Live plans use `EXPLAIN (FORMAT JSON, VERBOSE TRUE, COSTS TRUE)`; ANALYZE, BUFFERS and TIMING are never requested. Costs are optimizer units. Actual metrics are displayed only when imported JSON includes them.

Supported SQL forms are SELECT, VALUES, INSERT (SELECT or VALUES sources, RETURNING, ON CONFLICT), WITH ending in SELECT or INSERT, and supported unions. pgsql-ast-parser classifies the entire single statement. Data-modifying CTEs, standalone UPDATE/DELETE, SELECT INTO and locking SELECTs are rejected. INSERT is submitted only after an EXPLAIN prefix, never as a standalone command. Unsupported parser syntax fails closed. Selected text is used exclusively. With no selection, the entire file is used; the cursor position does not choose a statement. Both paths accept up to 20 semicolon-delimited statements. Each candidate is independently classified with the PostgreSQL AST parser and must be one supported statement. Unsupported or invalid statements appear as individual errors; ambiguous/unclosed lexical constructs stop the batch before collection. Empty input and log text are not interpreted as SQL. Dollar-quoted expressions and INSERT DEFAULT VALUES may be rejected by the AST parser.

Mappings cover scans, index and bitmap access, joins, hashing, sorting, aggregation, limits, materialization, parallel gathers and append operators. See operatorMapping.ts for the full independent mapping. Unknown operations become OTHER and preserve their names and attributes.

TLS options are disabled (local development) or certificate verification using Node's trust store. Custom CA/client certificate selection and insecure TLS bypass are not implemented. No connection pooling or live ANALYZE is provided.

INSERT plans display the native ModifyTable operation as Insert while preserving the PostgreSQL node type and Operation attribute. Six INSERT forms, including the quoted generator-lookup join, were verified on PostgreSQL 18.4 with unchanged target row counts.
