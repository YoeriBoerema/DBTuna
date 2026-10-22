# Implementation status

The current source is v0.6.6. Product usage belongs in the [README](README.md), module responsibilities in [architecture](docs/architecture.md), and test evidence in [verification](docs/verification.md).

Implemented:

- PostgreSQL and SQL Server estimated plans normalized into a shared validated graph.
- Exact selection or whole-file planning, independent query sections, progress and cancellation.
- Compact horizontal and card views, operator details and delayed cost tooltips.
- Typed connections, secure credentials, offline imports and estimated-plan/batch exports.
- Confirmed SELECT/INSERT actual runs with original-connection binding and explicit uncertainty after errors.
- Optional structured AI advice with API-key/model setup and no automatic SQL execution.
- Modular connectors, host services, UI components/reducers, connection repository and shared limits.
- A repeatable verification command with a shared browser harness.

Remaining product scope includes additional database types, broader SQL syntax, a results grid, persistent actual-plan history, side-by-side comparison and optional heuristic diagnostics. Live SQL Server and OpenAI verification, connection-dialog walkthroughs and PostgreSQL 14-17 compatibility remain unverified in this environment. These are limitations, not committed delivery dates.
