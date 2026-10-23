# Changelog

Published downloads are available in [GitHub Releases](https://github.com/YoeriBoerema/DBTuna/releases). Version numbers in the source can be ahead of published VSIX files.

## Unreleased

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
