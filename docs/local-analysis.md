# Local plan analysis

PostgreSQL and SQL Server plans are analyzed locally, without an API key or AI request. Operator details show findings for the selected operator; **Show whole query** includes findings elsewhere in that statement. Estimated/Actual view switching analyzes the displayed plan. Imported plans also work, subject to the evidence they contain.

Each finding has a stable rule ID and version, severity, confidence, operator IDs, observed values, suggested investigation and limitations. Findings are computed from the plan without SQL execution, schema queries, automatic rewrites or index changes. AI assistance remains a separate explicit action.

| Rule | Default evidence threshold | Interpretation |
| --- | --- | --- |
| `cardinality.discrepancy` | At least 10x discrepancy and 1,000 rows absolute difference per execution | Investigate estimates, skew, parameters and statistics; stale statistics are not proven |
| `memory.spill` | PostgreSQL disk sort, positive disk usage or hash batches above one; SQL Server native spill marker | Disk-backed work was reported; memory changes require workload review |
| `work.repeated-access` | At least 1,000 scan/index executions returning at least 100,000 rows total | Review repeated access and its parent join; repeated seeks can be efficient |
| `filter.discarded-rows` | At least 10,000 examined rows and at least 90% rejected | Investigate residual filtering and access paths; no automatic missing-index prescription |
| `predicate.plan-affecting-conversion` | SQL Server `PlanAffectingConvert` warning | Review parameter/column types; the warning does not prove the bottleneck |
| `predicate.expression-review` | Heavy filtering above, scan/index predicate containing a recognized function and no conversion warning | Low-confidence textual candidate; expressions on constants and expression indexes may be harmless |
| `native.warning` | Other SQL Server structured operator/statement warnings | Inspect native attributes for the engine-specific warning |

The shared analyzer consumes facts from database-specific extractors. PostgreSQL per-loop rows and filter counts are multiplied only when a positive loop count and known scope are present. SQL Server total rows are normalized by execution counts for comparisons; rows-read counters are summed only when all reported threads supply them. Parallel SQL Server per-execution cardinality comparisons are suppressed. The cardinality ratio uses a denominator floor of one for zero/small estimates.

Cardinality diagnoses are also suppressed beneath LIMIT/Top and recognized merge/semi/anti joins because partial consumption can resemble estimation errors. Other short-circuit or parameter effects remain possible and are called out in findings. Execution times and optimizer costs are never summed or compared across engines by these rules.

The coverage disclosure reports comparable row counters and missing context. No findings means no rule found sufficient evidence, not that the query is optimal. There is no universal quality score, predicted speedup, schema/index verification or correctness guarantee for suggested changes. PostgreSQL has no equivalent generic structured warning rule; its native runtime signals drive the spill and filtering checks.

Developer entry points: `packages/plan-analysis/src/analyze.ts` contains pure rules and configurable thresholds; `facts.ts` extracts native evidence without crossing operator boundaries. Threshold overrides are currently a programmatic API, not VS Code settings. Extend fact extractors and fixture tests when adding a database, rather than making rules interpret arbitrary native payloads.
