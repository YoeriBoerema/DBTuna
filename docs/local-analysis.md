# Local plan analysis

PostgreSQL, SQL Server and Oracle plans are analyzed locally, without an API key or AI request. Operator details show findings for the selected operator; **Show whole query** includes findings elsewhere in that statement. Click a finding (or focus it and press Enter/Space) to select, highlight and center its operator using the same navigation as the dropdown. Estimated/Actual view switching analyzes the displayed plan. Findings explicitly distinguish **Estimated risk**, **Measured evidence** and **Native plan evidence**. Explain alone can produce estimated findings; query execution is not required. Imported plans also work, subject to the evidence they contain.

Each finding has a stable rule ID and version, severity, confidence, operator IDs, observed values, suggested investigation and limitations. Findings are computed from the plan without SQL execution, schema queries, automatic rewrites or index changes. AI assistance remains a separate explicit action.

| Rule | Default evidence threshold | Interpretation |
| --- | --- | --- |
| `estimate.large-result` | At least 100,000 estimated output rows for joins/aggregates/appends/materialization; join expansion highlighted at 10x the largest known input | Volume risk, not evidence of a bad join or slow execution |
| `estimate.sort-hash-input` | At least 100,000 estimated input rows (or operator rows when inputs are absent) | Review input volume and projected width; estimated bytes are not a memory grant or spill prediction |
| `estimate.repeated-access` | At least 1,000 estimated invocations and 100,000 estimated returned rows | SQL Server uses explicit estimated rebinds + rewinds + 1; PostgreSQL uses a directly identified nested-loop outer row estimate, without crossing caches |
| `estimate.predicate-expression` | Recognized function with a potential column argument in a scan/index residual predicate on an estimated plan | Low-confidence textual candidate; literals, simple parameters and quoted function-like identifiers are masked |
| `estimate.native-missing-index` | SQL Server native MissingIndexes metadata | Preserve candidate columns and estimated impact for review; no DDL or promised runtime improvement |
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

Developer entry points: `packages/plan-analysis/src/analyze.ts` runs a registry of small rule modules in `rules/`. `contracts.ts` defines thresholds and finding contracts. Database-specific `postgresFacts.ts` and `sqlServerFacts.ts` normalize evidence without crossing operator boundaries. Per-rule coverage records evaluated/skipped operators and missing-evidence reasons; all SQL Server conversion expressions retain their operator/statement provenance. Threshold overrides are currently a programmatic API, not VS Code settings. Extend fact extractors and fixture tests when adding a database, rather than making rules interpret arbitrary native payloads.

Estimated rules also disclose missing evidence through rule coverage. Unknown estimates are not treated as zero; potentially partial consumption suppresses repeated-access inferences. Large scans alone are not flagged as missing-index problems. Sort/hash checks may still apply below LIMIT because blocking work can consume substantial input. All input-volume estimates remain subject to row goals, plan choices, skew and inaccurate estimates.

SQL Server missing-index suggestions are statement-level evidence, attached to the result operator rather than asserted to identify a particular scan. Review existing indexes, key ordering, overlapping candidates, write overhead and workload before testing changes. The optimizer's Impact value is an estimated cost reduction, not a measured or promised speedup. See [Microsoft's limitations](https://learn.microsoft.com/en-us/sql/relational-databases/indexes/tune-nonclustered-missing-index-suggestions).

Oracle facts also support estimated risks, measured cardinality/repeated access and last-workarea spills. Buffer gets never substitute for examined rows; unavailable native warning/index feeds and parallel/adaptive comparison scopes are disclosed in coverage. See [Oracle support](oracle-support.md).
