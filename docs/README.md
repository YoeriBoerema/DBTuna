# DBTuna documentation

DBTuna visualizes PostgreSQL, SQL Server and Oracle plans inside VS Code. This documentation describes the current main branch (see [build information](build-info.md) for its version). Published VSIX files are listed separately in [Releases](https://github.com/YoeriBoerema/DBTuna/releases); the latest published version is currently v0.7.1.

## Use DBTuna

| Guide | What it covers |
| --- | --- |
| [Getting started](getting-started.md) | Installation, connections, selection, actual runs and available commands |
| [PostgreSQL](postgres-support.md) | Supported SQL, plan collection and runtime metric semantics |
| [SQL Server](sqlserver-support.md) | Authentication, GO batches, Showplan import and actual execution limits |
| [Oracle Database](oracle-support.md) | Service/PDB connections, estimated/actual plans, Oracle SQL boundaries and permissions |
| [AI assistance](ai-assistance.md) | API-key/model setup, submitted data, scoring and suggestions |
| [Troubleshooting](troubleshooting.md) | Missing options, disabled execution and common errors |
| [Security](security.md) | Credentials, trust, execution, imports and external requests |

## Work on DBTuna

| Guide | What it covers |
| --- | --- |
| [Development](development.md) | Local setup, builds, verification, screenshots and VSIX packaging |
| [Architecture](architecture.md) | Module responsibilities, canonical data and asynchronous state |
| [Adding a connector](adapter-development.md) | Native parsing, live collectors and extension boundaries |
| [Verification](verification.md) | Current evidence, integration setup and remaining gaps |
| [Changelog](../CHANGELOG.md) | Published releases and current-source changes |

[Back to the repository](../README.md)
