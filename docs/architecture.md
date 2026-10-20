# Architecture

SQL editor → selected text (or whole file) / AST validation → extension-host PostgreSQL collector → PostgreSQL adapter → canonical QueryPlan → typed webview message → ELK layout → React Flow.

The collector uses a fresh pg client for each operation, a five-second connection timeout, a twelve-second client query timeout and a ten-second transaction statement timeout. It issues BEGIN READ ONLY, SET LOCAL, SHOW server_version, EXPLAIN, and ROLLBACK as separate protocol statements. Cancellation closes the client. The finally path releases resources even after failures.

The UI imports canonical types only. Passwords and connection objects never cross the host boundary. Webview commands are a finite, validated allowlist. A ready handshake prevents loss of initial state; the latest status is sent when ready. Plans survive hidden panels and webview state reloads; reopening a disposed panel starts a new view.

Imports are bounded to 5 MiB, 64 JSON nesting levels, 150,000 values and 1,000 graph operators. Graph validation requires unique IDs, valid endpoints, an acyclic rooted forest and no disconnected nodes. Layout uses the layered ELK algorithm with parent-to-child direction. Deterministic PostgreSQL IDs follow tree paths.

The presentation layer supports compact horizontal and top-down card layouts. ELK still lays out the canonical parent-to-child graph; compact view displays edges in reverse (child → parent) with left-pointing arrowheads to represent data flow. Exported canonical graphs retain their original parent-to-child direction and ordering. Compact operator pictograms are local SVG React components and use the existing normalized categories.

For batches, lexical boundary scanning accounts for comments/quotes and fails closed on ambiguity, followed by PostgreSQL AST validation of each exact candidate. The batch service tracks ordered pending/running/complete/error/cancelled items and calls the existing collector sequentially. Complete plans keep independent canonical IDs and graph direction. A typed BATCH_LOADED snapshot updates the webview. Each numbered section owns a React Flow provider and independent selection; near-viewport lazy mounting bounds initial layout work. A versioned dbtuna-batch envelope handles import/export without changing the canonical QueryPlan format.
