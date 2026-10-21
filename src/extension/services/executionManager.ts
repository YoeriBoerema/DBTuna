import type { QueryPlan } from "../../../packages/plan-core/src/types";
import { validate } from "../../../packages/plan-core/src/schema";
import type { Profile } from "../connection/profile";
import type { ConnectionManager } from "../connection/connectionManager";
import { collectActualPlan, clientConfig } from "../connection/postgresClient";
import { collectActualSqlServerPlan } from "../connection/sqlServerClient";
import { PostgresAdapter } from "../../../packages/adapter-postgres/src/postgresAdapter";
import { SqlServerAdapter } from "../../../packages/adapter-sqlserver/src/sqlServerAdapter";
import type { ExtensionToWebview } from "../webview/messages";
import { executionQuery } from "./executionQuery";
type ExecutionPlatform = {
  trusted: () => boolean;
  confirm: (title: string, detail: string) => Promise<boolean>;
  exportPlan: (plan: QueryPlan) => Promise<void>;
};
type ActualCollector = (
  profile: Profile,
  password: string | undefined,
  sql: string,
  signal: AbortSignal,
) => Promise<{ raw: unknown; version?: string }>;
const collectActual: ActualCollector = (profile, password, sql, signal) =>
  profile.type === "postgresql"
    ? collectActualPlan(clientConfig(profile, password), sql, signal)
    : collectActualSqlServerPlan(profile, password, sql, signal);
export class ExecutionManager {
  private bindings = new Map<string, { plan: QueryPlan; profile: Profile }>();
  private actuals = new Map<string, QueryPlan>();
  private seenRequests = new Set<string>();
  private active?: { id: string; abort: AbortController };
  constructor(
    private connections: Pick<ConnectionManager, "profiles" | "password">,
    private notify: (message: ExtensionToWebview) => void,
    private isCurrent: (id: string) => boolean,
    private platform: ExecutionPlatform,
    private collect: ActualCollector = collectActual,
  ) {}
  register(plan: QueryPlan, profile: Profile) {
    if (this.bindings.has(plan.id)) return;
    try {
      executionQuery(plan);
      plan.metadata.executionAvailable = true;
    } catch (error) {
      plan.metadata.executionAvailable = false;
      plan.metadata.executionUnavailableReason =
        error instanceof Error ? error.message : "Unsupported query.";
    }
    this.bindings.set(plan.id, { plan, profile: { ...profile } });
  }
  findActual(id: string) {
    return [...this.actuals.values()].find((plan) => plan.id === id);
  }
  cancel(id?: string) {
    if (!id || this.active?.id === id) this.active?.abort.abort();
  }
  reset() {
    this.cancel();
    this.bindings.clear();
    this.actuals.clear();
    this.seenRequests.clear();
  }
  async export(planId: string) {
    const plan = this.actuals.get(planId);
    if (!plan || !this.isCurrent(planId)) return;
    await this.platform.exportPlan(plan);
  }
  async run(planId: string, requestId: string) {
    if (this.seenRequests.has(requestId)) return;
    this.seenRequests.add(requestId);
    if (this.active) {
      this.notify({
        type: "EXECUTION_RESULT",
        planId,
        requestId,
        status: "error",
        error: "Another query execution is pending. Finish or cancel it first.",
      });
      return;
    }
    const abort = new AbortController();
    this.active = { id: requestId, abort };
    let started = false;
    const notify = (
      change: Omit<
        Extract<ExtensionToWebview, { type: "EXECUTION_RESULT" }>,
        "type" | "planId" | "requestId"
      >,
    ) =>
      this.notify({ type: "EXECUTION_RESULT", planId, requestId, ...change });
    try {
      if (!this.platform.trusted())
        throw Error("Trust the workspace before executing SQL.");
      const binding = this.bindings.get(planId);
      if (!binding || !this.isCurrent(planId))
        throw Error(
          "Run Explain again to enable execution on this live connection.",
        );
      const current = this.connections
        .profiles()
        .find((profile) => profile.id === binding.profile.id);
      if (
        !current ||
        JSON.stringify(current) !== JSON.stringify(binding.profile)
      )
        throw Error(
          "The connection changed. Run Explain again before executing.",
        );
      const { sql, kind } = executionQuery(binding.plan);
      const confirmed = await this.platform.confirm(
        `Run ${kind} on ${current.name} (${current.host}:${current.port}/${current.database})?`,
        `This executes only the displayed query, not the whole file. ${kind === "INSERT" ? "INSERT changes will be committed and may fire triggers." : "SQL and functions will actually run."} Cancellation may not undo changes. A repeated run repeats the SQL.\n\n${sql}`,
      );
      if (!confirmed || abort.signal.aborted || !this.isCurrent(planId)) {
        notify({ status: "cancelled", error: "Execution was not started." });
        return;
      }
      const fresh = this.connections
        .profiles()
        .find((profile) => profile.id === current.id);
      if (!fresh || JSON.stringify(fresh) !== JSON.stringify(binding.profile))
        throw Error("The connection changed. Run Explain again.");
      const password = await this.connections.password(current);
      if (abort.signal.aborted) throw Error("Execution cancelled.");
      notify({ status: "running" });
      const start = Date.now();
      started = true;
      const result = await this.collect(current, password, sql, abort.signal);
      const elapsedMs = Date.now() - start;
      let actual: QueryPlan;
      if (current.type === "postgresql")
        actual = new PostgresAdapter().parse(result.raw);
      else {
        const adapter = new SqlServerAdapter();
        const statements = (
          Array.isArray(result.raw) ? result.raw : [result.raw]
        ).flatMap((raw) => adapter.parseStatements(raw));
        const normalize = (text: string | undefined) =>
          (text || "").trim().replace(/;\s*$/, "");
        const matches = statements.filter(
          (plan) => normalize(plan.query) === normalize(binding.plan.query),
        );
        const candidates = matches.length
          ? matches
          : statements.filter((plan) => plan.metadata.statementType === kind);
        if (candidates.length !== 1)
          throw Error(
            "The query ran, but its actual plan could not be identified uniquely among returned statement/trigger plans.",
          );
        actual = candidates[0];
      }
      if (abort.signal.aborted) throw Error("Execution cancelled.");
      if (!actual.nodes.some((node) => node.actuals))
        throw Error("Query ran but no actual runtime counters were returned.");
      actual.id = planId + ":actual:" + requestId;
      actual.query = binding.plan.query;
      actual.metadata.planKind = "actual";
      actual.metadata.clientElapsedMs = elapsedMs;
      actual.metadata.connectionLabel = current.name;
      actual.source.capturedAt = new Date().toISOString();
      if (result.version) actual.database.version = result.version;
      validate(actual);
      this.actuals.set(planId, actual);
      notify({ status: "complete", actualPlan: actual, elapsedMs });
    } catch (error) {
      notify({
        status: abort.signal.aborted ? "cancelled" : "error",
        error:
          (error instanceof Error ? error.message : "Execution failed.") +
          (started
            ? " Data may already have changed, even if the plan was not collected. Check the database before retrying."
            : ""),
      });
    } finally {
      if (this.active?.abort === abort) this.active = undefined;
    }
  }
  dispose() {
    this.reset();
  }
}
