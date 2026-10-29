# Changelog

Published downloads are available in [GitHub Releases](https://github.com/YoeriBoerema/DBTuna/releases). Version numbers in the source can be ahead of published VSIX files.

## 0.8.1

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.8.1)

- Require a modal confirmation in the extension host before actual SELECT/INSERT execution, and revalidate the live plan, workspace trust and connection after approval and credential retrieval.
- Bound PostgreSQL plaintext and decrypted TLS responses before protocol parsing, reject oversized declared frames, and enforce aggregate UTF-8 plan limits for object inputs. Validate actual response size before COMMIT.
- Sanitize database errors before UI/export, preserve controlled permission/timeout and uncertain-write guidance, and omit historical diagnostics when restoring imported batches.
- Suggest a dedicated `dbtuna` username for new connections and document minimum database privileges.
- Refresh vulnerable transitive MSAL Node and fast-uri dependencies; use a frozen pnpm lockfile for reproducible releases and pin the PostgreSQL driver used by the protocol guard.
- Add regression coverage for approval bypasses, stale authorization, native error disclosure, aggregate plan size and oversized frames through the real PostgreSQL driver over plaintext and verified TLS.

## 0.8.0

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.8.0)

- Add a database-wide table relationship diagram for PostgreSQL, SQL Server and Oracle, opened directly from a database connection in the Database Explorer without connection or schema prompts.
- Show foreign-key column rows, dividers, column-level arrows, composite keys, self-references and cross-schema relationships, including disconnected tables.
- Group tables by schema with wide spacing and measured card sizes; add independent obstacle-aware routing with crossing/overlap penalties, parallel lane candidates and bounded optimization.
- Add Auto layout and Reroute lines controls, preserving manual table placement when rerouting, plus relationship highlighting and dimming.
- Use an Okabe–Ito-based palette and redundant line patterns, matching schema legends and theme-aware contrast; verify with deuteranopia simulation.
- Add Show Database Explorer and an enabled-by-default Always Show Database Explorer setting.
- Verify diagram JavaScript/CSS inside packaged VSIX files, and preserve bundled asset line endings for reproducible integrity checks.

## 0.7.3

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.7.3)

- Add a lazy Database Explorer for PostgreSQL, SQL Server and Oracle schemas, tables, columns, primary/foreign keys, unique constraints and indexes, with refresh, cancellation and permission-aware empty states.
- Simplify the visualization batch summary to its dynamic query count.

## 0.7.2

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.7.2)

- Label each query Predicted until a successful actual-plan collection, then Verified; preserve verification when switching views and reset it for a fresh Explain.
- Remove the large AI Assistance button from the visualization header; operator advice and VS Code AI settings remain available.

- License original DBTuna materials on the current branch for non-commercial use and free sharing only; explicitly prohibit commercial use and resale. Existing MIT releases through v0.7.1 and independently licensed third-party components retain their original terms.

## 0.7.1

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.7.1)

- Add disposable Docker integration runners for PostgreSQL, SQL Server and Oracle with pinned images, generated credentials, localhost-only ports and ownership-checked cleanup.
- Add `npm run test:databases` and `npm run verify -- --databases`, plus individual engine runners.
- Replace embedded PostgreSQL and its native dependency with the shared Docker approach; fixture updates are now explicit.
- Expand live SQL Server and Oracle coverage for estimates, actual SELECT/INSERT, batches, failed writes, cancellation, permissions, large rowsets and LOB cleanup.
- Preserve a captured Oracle Free plan and add Docker lifecycle regressions. Live verification passed on PostgreSQL 18.4, SQL Server 2022 and Oracle Free 23.26.3.

## 0.7.0 - The Oracle Has Arrived!

- Add Oracle Thin service/PDB connections, optional schema and verified TCPS. Existing profiles are preserved.
- Add Oracle-aware batches, safe setup/PLSQL skipping, structured estimated plans and exact-cursor actual SELECT/INSERT collection.
- Reuse inline run/cancel confirmation, graph navigation, resizable panels, operator findings and AI assistance for Oracle.
- Add Oracle local evidence extraction, native JSON/DBMS_XPLAN imports, fixtures, collector tests and an opt-in isolated live integration suite.
- Document Oracle permissions, metric differences and unsupported SQL/connection forms. Live Oracle integration remains unverified in this environment.
- Add clearly labeled estimated-plan analysis for PostgreSQL and SQL Server: large intermediate results, join expansion, sort/hash workload, repeated access and predicate-expression candidates.
- Surface SQL Server native missing-index candidates for workload review without generating or executing DDL.

## 0.6.14

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.6.14)

- Move statement classification into connectors and reuse parsed PostgreSQL statements during preparation.
- Split database fact extractors and individual analysis rules; preserve all conversion warnings with provenance and report rule applicability.
- Reconcile plan snapshots without whole-plan serialization and consolidate execution confirmation/display state.
- Separate batch presentation, feature styles and behavioral test suites; remove obsolete fitting state.
- Derive package names from the manifest, verify archived runtime bundles, generate build information and enforce formatting checks.

## 0.6.13

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.6.13)

- Resize visualization boxes vertically by dragging the bottom-right corner.
- Support single plans and independent query boxes in batches, with a minimum height and visible navigation footer.

## 0.6.12

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.6.12)

- Click a local analysis finding to select, highlight and center its operator using the Navigate dropdown behavior.
- Support Enter and Space activation and visible keyboard focus.
- Prevent automatic fitting from overriding navigation and fix duplicate analysis-panel keys when switching operators.

## 0.6.11

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.6.11)

- Add local rules-based analysis for PostgreSQL and SQL Server, with evidence, confidence, limitations and per-operator or whole-query findings.
- Check cardinality discrepancies, spills, repeated access, filtering, predicate candidates and SQL Server warnings without AI requests or database changes.

## 0.6.10

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.6.10)

- Classify parsed unsupported PostgreSQL statements as skipped, while retaining syntax and collection errors.
- Include the SQL Server tolerance and confirmation fixes from local builds 0.6.8 and 0.6.9.

## 0.6.9 (local build)

- Add tolerant SQL Server explanation with skipped-statement reasons and independent query failure handling.
- Add two-click cancellation confirmation.

## 0.6.8 (local build)

- Remove the inline execution warning from the visualization while retaining the two-click **Are you sure?** confirmation.

## 0.6.7

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.6.7)

- Replace the actual-plan confirmation dialog with a two-click button: first click displays **Are you sure?**, second click executes the query.
- Require fresh confirmation for each SELECT or INSERT run, including reruns.
- Preserve original-connection, workspace-trust and duplicate-execution guards.

## 0.6.6

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.6.6)

Changes since [v0.6.2](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.6.2):

- Support deeper SQL Server execution plans while retaining bounded imports.
- Separate graph components and lifecycle hooks; extract Explain and file workflows from activation.
- Introduce a database connector contract and typed application plan fields with legacy import migration.
- Keep SQL execution setup in host-only bindings and make asynchronous outcomes explicit.
- Parse SQL Server XML once, preserving scoped native XML and whole-document limits.
- Separate connection persistence from prompts and compare originating connections by configuration fields.
- Separate AI transport, advice validation and UI formatting; derive provider schemas from the shared contract.
- Centralize resource/time policies and consolidate browser checks behind `npm run verify`.
- Regenerate screenshots only through an explicit command.

## 0.6.2

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.6.2)

Simplify the plan screen by removing the Import, Fit view, Export actual plan and Export batch buttons. Single-plan export and automatic graph fitting remain available; import and estimated batch export remain Command Palette actions.

## 0.6.1

[Release and VSIX](https://github.com/YoeriBoerema/DBTuna/releases/tag/v0.6.1)

SQL Server query previews decode numeric XML character references correctly, avoiding false statement-boundary detection and incorrectly disabled Run actions. This release also contains typed PostgreSQL/SQL Server connections, per-statement SQL Server graphs, optional OpenAI advice, and the confirmed actual-plan SELECT/INSERT MVP.

Earlier implementation notes are retained in the [verification history](docs/archive/verification-history.md); they describe historical behavior rather than the current interface.
