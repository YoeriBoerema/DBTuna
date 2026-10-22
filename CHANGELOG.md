# Changelog

Published downloads are available in [GitHub Releases](https://github.com/YoeriBoerema/DBTuna/releases). Version numbers in the source can be ahead of published VSIX files.

## Current source: 0.6.5 (not yet released)

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
