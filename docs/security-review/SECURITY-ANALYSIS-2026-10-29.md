# DBTuna security analysis and LLM remediation specifications

Reviewed 29 October 2026. Target: DBTuna 0.8.0, local Git checkout at commit `313408077937bd586aceaba7a1d489dcc01db1ec`, repository `https://github.com/YoeriBoerema/DBTuna`. Findings apply to this source snapshot, not necessarily the latest GitHub branch or a published VSIX.

**Remediation update — v0.8.1:** SEC-001 through SEC-004 have been addressed. The sections below preserve the original assessment and evidence limits. Current regression coverage is in `test/unit/security.test.ts` and `test/unit/postgres-budget.test.ts`; `probes.mjs` now launches these regressions instead of asserting vulnerable behavior. PostgreSQL wire limits are enforced before the real driver's parser for both plaintext and verified TLS. See `RELEASE-VERIFICATION.md` for final release validation.

The subsequent automated dependency audit identified five transitive-package advisories that the original targeted web checks did not discover: [CVE-2026-109461 / GHSA-xcx6-jx8p-x3h5](https://github.com/advisories/GHSA-xcx6-jx8p-x3h5) in MSAL Node, and [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h), [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr), [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) in fast-uri. The advisory severities were one High, two Moderate and two Low. MSAL's affected authorization-code flow is outside DBTuna's supported authentication paths; exploitability in DBTuna was not established. Release dependencies now resolve MSAL Node 7.1.0 and fast-uri 3.1.9, and the refreshed full dependency audit reports zero known vulnerabilities. The MSAL major override is recorded in `pnpm-workspace.yaml` because Azure Identity still declares a vulnerable major range; supported SQL Server authentication is covered by live integration tests.

## Results

| ID | Severity | Issue | Evidence / qualification |
| --- | --- | --- | --- |
| SEC-001 | **Medium** | Actual SQL execution confirmation exists only in the webview | Host bypass reproduced with mocks; exploitation requires control of the existing plan webview. Conditional security boundary weakness. |
| SEC-002 | **Medium** | PostgreSQL plan responses are buffered without a response byte budget | Oversized response and object validation bypass reproduced with mocks; memory exhaustion is an inferred consequence. |
| SEC-003 | **Medium** | Raw database errors reach UI and exportable batch data | Sentinel disclosure reproduced with mocks; actual sensitive content depends on database errors. |
| SEC-004 | **Low** | New connections suggest database administrator usernames | Confirmed in wizard source; unsafe default, not an authentication bypass. |

**No High-severity exploit was established.** Medium findings have meaningful prerequisites; none establishes unauthenticated remote access, arbitrary file execution, or a working XSS exploit. SEC-001 in particular must not be described as an imported-plan-to-execution exploit.

Severity uses the requested Low / Medium / High scale. High means a demonstrated path to substantial compromise without a separate unproven compromise; Medium means material risk involving user interaction, a conditional boundary failure, or availability/data exposure within the developer session; Low means an unsafe default or limited hardening gap. These are contextual review ratings, not published CVSS scores. No CVE is assigned to these newly identified source-level issues.

## Scope and evidence limits

Reviewed extension activation, credential persistence and connection setup, all database connectors, SQL eligibility and execution preparation, live-plan binding, webview messaging and CSP, plan imports/exports and canonical validation, catalog readers, AI transport/payload construction, dependency manifests/lockfile, packaging, and relevant tests/documentation. This was a targeted manual code review, not a formal exhaustive audit.

The accompanying `probes.mjs` loads the relevant current TypeScript source through Node's TypeScript transformation, injects mock collaborators, and checks five failure conditions. It performs no network access, opens no database connections, executes no SQL, and reads no saved credentials. Run from the repository root with Node 24:

```sh
node docs/security-review/probes.mjs
```

All five probes passed on the reviewed snapshot. Collaborators such as schema validation and collectors are mocked where noted in the script; these probes establish local control flow and propagation, not complete VS Code, driver, or database exploit chains. Application code was not modified.

The checkout has no installed `node_modules`, and `npm` is unavailable on PATH. The normal unit/browser/integration suites and a complete dependency scanner were not run. A direct OSV API request failed because the network connection could not be established. Targeted public advisory checks used browsing instead. No database integration or stress test was performed. GitHub organization settings, Actions secrets, branch protection, release provenance, and historical secret exposure were not assessed.

## SEC-001 — Medium — Host does not independently confirm actual execution

**Classification:** [CWE-602: Client-Side Enforcement of Server-Side Security](https://cwe.mitre.org/data/definitions/602.html), applied by analogy to the lower-trust webview and privileged extension host. The intended trust separation is also consistent with [VS Code webview security guidance](https://code.visualstudio.com/api/extension-guides/webview#security).

**Affected locations:**

- `webview/src/hooks/useActualExecution.ts:54`: the first click only arms React state; the second sends `RUN_ACTUAL`.
- `src/extension/extension.ts:57`: forwards a valid message directly to `ExecutionManager.run`.
- `src/extension/services/executionManager.ts:64`: verifies trust, binding, connection and query eligibility, then obtains the password and invokes the collector; no host-controlled confirmation occurs.

**Root cause:** The two-click gesture is enforced entirely inside the webview. A schema-valid message containing a current live `planId` and a new `requestId` is sufficient to start execution. Request IDs provide deduplication, not evidence that the human approved execution.

**Prerequisites and impact:** A trusted workspace, an eligible host-registered live plan and saved connection, plus the ability to run script in that plan's webview or otherwise control its outgoing messages. This review found no script injection path that supplies that prerequisite. If the prerequisite is met, the host can commit the already-bound INSERT or execute the already-bound SELECT without a new human approval. The attacker cannot choose arbitrary SQL through this message or activate an imported plan. Rate as Medium because this is a conditional boundary weakness with potentially serious write impact, not a complete attack chain.

**Reproduction:** In the offline probe, register a live INSERT plan and call `run(planId, 'single-message')` once. The mocked collector is invoked and completes despite there being no host confirmation collaborator. A real webview message follows the same dispatch path. The collector is mocked; no INSERT is executed by the probe.

**LLM remediation specification:**

> Implement host-controlled human confirmation for every actual execution in `ExecutionManager` and its VS Code platform adapter. Keep the inline two-click flow as a UI convenience if desired, but treat `RUN_ACTUAL` solely as a request to begin host approval. Before obtaining credentials or calling a collector, display a modal VS Code confirmation showing the original connection label, engine, original SQL, and statement kind. State that INSERT commits changes and SELECT can have function side effects. Default dismissal/cancel must prevent execution. Keep the existing active-request lock while the dialog is open. After approval and after asynchronous credential retrieval, revalidate cancellation, workspace trust, current live binding, current plan identity and unchanged connection configuration. Never accept `confirmed: true` or another webview-generated approval flag as authorization. Preserve imported-plan exclusion, original-query binding, duplicate suppression and no automatic retries.

**Acceptance tests:**

1. A single valid run message reaches a mocked host confirmation gate, and the collector stays at zero until approval.
2. Rejection, dialog dismissal, cancellation, removed/replaced plan, connection changes or loss of trust prevent collection.
3. Confirmation applies to both SELECT and INSERT, and a fresh request requires fresh approval.
4. Duplicate and concurrent messages cannot open multiple execution paths or repeat a committed INSERT.
5. Arbitrary/imported IDs remain rejected before any database operation; existing uncertain-write messaging remains intact.

**CVE applicability:** No matching DBTuna CVE was established. Do not attach an unrelated client-side authorization CVE to this issue.

## SEC-002 — Medium — PostgreSQL responses lack an enforced byte budget

**Classification:** [CWE-770: Allocation of Resources Without Limits or Throttling](https://cwe.mitre.org/data/definitions/770.html).

**Affected locations:**

- `src/extension/connection/postgresClient.ts:58` and `:91`: estimated/actual EXPLAIN responses are read through `client.query()` in full.
- `packages/plan-core/src/schema.ts:97`: `bounded()` checks bytes only when its input is a string. Object inputs are checked for depth/value count, but string values have no aggregate byte budget.
- `packages/adapter-postgres/src/postgresAdapter.ts:22`: the PostgreSQL adapter receives already-parsed objects and retains arbitrary native string properties.
- `packages/plan-core/src/batch.ts:61`: a later batch serialization rejects oversized data only after the driver has received it and normalization has occurred.

**Root cause:** Timeouts, operator count and object-depth limits do not bound response memory. A small number of very large string values passes the object traversal limits. The PostgreSQL driver materializes query results before the adapter or batch rejects them. The driver's documented query interface returns collected rows; see [node-postgres queries](https://node-postgres.com/features/queries).

**Prerequisites and impact:** A database response with unusually large EXPLAIN data, such as verbose expressions/object names or a hostile/compromised server, during a user-triggered collection. TLS verifies the server identity but does not bound its output. A sufficiently large response can consume extension-host memory and stall or terminate the host. This is an availability risk; no code execution was demonstrated. Later batch limits reduce retained/exported data but cannot undo peak allocation.

**Reproduction:** The probe supplies a single property containing `PLAN_LIMITS.bytes + 1` characters. `bounded(object)` accepts it while `bounded(JSON.stringify(object))` rejects it. A mocked PostgreSQL `collectPlan()` response returns the same oversized object successfully. The probes deliberately use about 5 MiB rather than attempting to exhaust memory.

**LLM remediation specification:**

> Add a shared response budget to PostgreSQL estimated and actual plan collection. Enforce the 5 MiB plan budget before JSON parsing/normalization whenever possible, and make object-form canonical/native validation enforce an aggregate string/serialized-byte budget too. Account for UTF-8 byte lengths and serialization overhead; avoid making an unbounded full JSON copy merely to discover the response is too large. A post-query `JSON.stringify` check alone does not fix driver-side peak memory allocation. Investigate a bounded protocol/result reader, a driver-supported response limit, or an isolated worker/process with a hard memory ceiling if a single PostgreSQL field is materialized before row callbacks. Stop and close the dedicated connection when limits are exceeded. Document any residual single-field allocation limit honestly. Keep deadlines, rollback/cleanup, cancellation and no-retry behavior. Preserve an uncertain-outcome warning if actual execution may already have committed or caused external effects. Do not truncate plans silently.

**Acceptance tests:**

1. An oversized single native string and many smaller strings exceeding the total budget are rejected in both object and JSON input forms.
2. Test non-ASCII UTF-8 strings near the limit, and valid plans below the limit.
3. Fake transport tests show receipt stops at the budget rather than after complete normalization, with connection cleanup.
4. In a disposable test process/server only, verify the chosen transport strategy has a bounded peak allocation for an oversized single field. Do not stress the main VS Code process.
5. Cancellation, actual-write uncertainty and normal valid collection remain correct.

**CVE applicability:** No specific PostgreSQL-driver CVE was established for this application-level missing budget.

## SEC-003 — Medium — Database errors disclose unfiltered text to presentation and exports

**Classification:** [CWE-209: Generation of Error Message Containing Sensitive Information](https://cwe.mitre.org/data/definitions/209.html).

**Affected locations:**

- `src/extension/services/batchExplain.ts:104`: raw collector `Error.message` becomes a batch item's `error`.
- `src/extension/services/executionManager.ts:136`: raw execution `Error.message` is sent in `EXECUTION_RESULT`.
- `src/extension/extension.ts:104`: command exceptions are displayed verbatim.
- `src/extension/services/planFiles.ts:69`: export chooses the batch, including failed items and their error strings.
- PostgreSQL and SQL Server collectors generally propagate driver errors; Oracle collection and metadata browsing already sanitize several failure paths.

**Root cause:** Driver/server errors are treated as safe user-facing diagnostics. Server-controlled error messages can contain SQL fragments, values echoed by conversions, function exception text, object names, account names or connection details. Plain-text rendering prevents HTML injection but does not prevent disclosure or persistence in an exported batch.

**Prerequisites and impact:** A normal failed query, application function/trigger that raises sensitive text, or a hostile server. Sensitive error text crosses into the webview/notifications and, for estimate batches, exported JSON that may later be shared. This does not establish disclosure of the SecretStorage password: a driver message must actually include sensitive content. The user already sees their submitted SQL, so the most relevant additional exposure is server-side values and durable/shared diagnostics beyond the selected statement.

**Reproduction:** Inject `Error('SENSITIVE_SERVER_VALUE_7429')` from a mocked collector. The execution result contains the sentinel. The estimate batch also retains the exact sentinel in `items[0].error`; exporting that batch serializes it. Both propagation conditions pass in the offline probes.

**LLM remediation specification:**

> Introduce a shared safe database error mapper for PostgreSQL, SQL Server and Oracle. Distinguish DBTuna-generated validation errors from untrusted driver/server errors using typed errors or explicit safe error codes, not message text matching. Render controlled operation-specific messages and allowlisted stable database codes (for example a validated SQLSTATE or numeric server code). Never forward native `message`, `detail`, `hint`, SQL, bindings, stack traces or nested causes to webviews, notifications, exports or logs by default. Cover connection testing and all estimate/actual failure paths as well as command-level catches. Preserve actionable permission/timeout/cancellation guidance and the existing warning that actual changes may already have committed. Sanitize restored legacy batch errors before presenting/exporting them if exports are advertised as sanitized; otherwise clearly distinguish imported untrusted error text. Do not promise general plan/SQL redaction, since plans intentionally contain sensitive SQL and native attributes.

**Acceptance tests:**

1. Sentinel secrets placed in each driver's `message`, nested cause, detail and hint do not appear in outbound messages, notifications or newly generated batch exports.
2. DBTuna validation messages still explain actionable supported-input errors.
3. Timeouts, cancellation, missing permissions and uncertain INSERT outcomes remain distinguishable without native error text.
4. Connection-test errors use the same mapping; no raw-error console logging is added.
5. Saved/imported batch errors have a documented and tested handling policy.

**CVE applicability:** No specific DBTuna CVE was established. CWE-209 describes the observed application behavior directly.

## SEC-004 — Low — Wizard suggests administrator identities for ordinary use

**Classification:** Least-privilege hardening; [CWE-250: Execution with Unnecessary Privileges](https://cwe.mitre.org/data/definitions/250.html) describes the risk when users accept the suggestion and supply administrator credentials. Username alone does not prove actual privileges.

**Affected location:** `src/extension/connection/connectionWizard.ts:53–60` defaults new SQL Server users to `sa` and PostgreSQL users to `postgres`; Oracle defaults to `dbtuna`.

**Root cause:** The default onboarding values encourage users to connect using conventional administrator identities even though metadata browsing and estimated plans generally need substantially fewer privileges. The documentation recommends least privilege, but the interactive default leads in the other direction.

**Prerequisites and impact:** A user accepts the suggested username and has corresponding elevated credentials. DBTuna then executes confirmed SQL with those account permissions. This amplifies mistakes and the impact of other weaknesses; it does not grant privileges, supply a default password, bypass authentication, or prove existing profiles are privileged. Low severity reflects the explicit user credential choice.

**Reproduction:** Start new PostgreSQL or SQL Server connection setup with no previous profile. Inspect the Username prompt's initial value. Source confirms `postgres` / `sa` without needing any database.

**LLM remediation specification:**

> For new profiles, replace administrator username defaults with an empty required field or a clearly documented dedicated-role suggestion such as `dbtuna`. Continue pre-filling the actual saved username when editing an existing profile. Add short engine-specific guidance for creating the minimum role needed for estimates/catalog reads and separate opt-in INSERT privileges for actual writes. Explain that arbitrary SELECT functions can have side effects and that least privilege remains necessary. Avoid introducing automatic GRANT statements or privilege changes. Do not reject a username merely because it resembles an administrator name; deployments can customize roles.

**Acceptance tests:**

1. New PostgreSQL and SQL Server setup never preselects `postgres` or `sa`.
2. Existing profiles retain their username when edited, and explicit administrator use remains a conscious supported choice.
3. Engine guides document minimum estimate/catalog privileges and separate optional execution privileges without encouraging broad administrator grants.

**CVE applicability:** None; this is an unsafe-default recommendation, not a known vendor vulnerability.

## Dependency CVE triage and remaining verification

The lockfile resolves `fast-xml-parser` to **5.11.2**. Two relevant published advisories were checked:

| Advisory | Published affected range | Conclusion for locked 5.11.2 |
| --- | --- | --- |
| [CVE-2026-73569 / GHSA-8r6m-32jq-jx6q](https://github.com/advisories/GHSA-8r6m-32jq-jx6q) | `>=5.9.3, <5.10.1` | Outside affected range. |
| [CVE-2026-26278 / GHSA-jmr7-xgp7-cmfj](https://github.com/advisories/GHSA-jmr7-xgp7-cmfj) | `>=4.1.3, <4.5.4` or `>=5.0.0, <5.3.6` | Outside affected ranges. |

Additionally, DBTuna rejects DTD/entity declarations and disables entity processing in its SQL Server parser. Do not report either CVE as an active finding here. These checks are not a clean bill of health for all direct/transitive dependencies or the vendored DOOM engine/WASM; the vendored binary was not reverse-engineered or fuzzed.

The project documents `npm install` but commits a pnpm lockfile and no npm lockfile. An npm installation does not reproduce the inspected pnpm resolution set. Treat this as a release-assurance follow-up: choose a canonical package manager, install from its frozen lockfile in verification/release builds, and audit the exact installed runtime and build-time dependency trees. Produce an SBOM for the bundled VSIX and match advisories against that artifact. No vulnerable package version is asserted solely from this workflow gap.

Suggested remaining work: full lockfile/installed-tree SCA, secret scanning of Git history, verification of release provenance and GitHub protections, parser fuzzing in isolated processes, and disposable database integration tests for the remediations. These are coverage gaps and follow-ups, not additional confirmed vulnerabilities.

## Controls that reduced severity or ruled out common findings

- Database passwords and the AI key are accessed through SecretStorage; persisted profiles contain metadata.
- Live operations check workspace trust. Actual execution requires an existing host binding to the original connection; imported flags do not authorize execution.
- Webview messages have strict schemas; the main plan webview restricts local resources and uses a nonce CSP. React renders native strings as text. No working XSS path was established.
- SQL Server estimates use separate SHOWPLAN ON/query/OFF calls on a dedicated session. PostgreSQL estimates use read-only transactions. Oracle validates runtime plans before its explicit INSERT commit.
- AI requests use a fixed HTTPS origin, reject redirects, have response/time limits and no tools, and require explicit advice requests. The visible choice to send SQL/native plan data is documented; provider upload itself is not listed as a vulnerability.
- Planning-time function evaluation and confirmed SELECT side effects are documented limitations. SQL classification is not a database permission sandbox. Their mere existence is not a new finding.

Recommended remediation order: SEC-001 and SEC-003 first, SEC-002 transport and validation limits next, then SEC-004. Validate each against isolated resources and retain the existing execution-safety tests.
