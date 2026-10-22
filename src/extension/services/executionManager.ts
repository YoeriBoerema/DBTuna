import type { QueryPlan } from "../../../packages/plan-core/src/types";
import { validate } from "../../../packages/plan-core/src/schema";
import { sameConnection, type Profile } from "../connection/profile";
import type { ConnectionManager } from "../connection/connectionManager";
import { databaseConnector } from "../connectors/registry";
import type { ExtensionToWebview, ExecutionOutcome } from "../webview/messages";
import { executionQuery } from "./executionQuery";
type ExecutionPlatform = {
  trusted: () => boolean;
  exportPlan: (plan: QueryPlan) => Promise<void>;
};
type ActualCollector = (
  profile: Profile,
  password: string | undefined,
  sql: string,
  signal: AbortSignal,
) => Promise<{ raw: unknown; version?: string }>;
const collectActual: ActualCollector = (profile, password, sql, signal) =>
  databaseConnector(profile.type).collectActual(profile, password, sql, signal);
export class ExecutionManager {
  private bindings = new Map<
    string,
    { plan: QueryPlan; profile: Profile; batchSql?: string }
  >();
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
  register(plan: QueryPlan, profile: Profile, batchSql?: string) {
    if (this.bindings.has(plan.id)) return;
    try {
      executionQuery(plan, batchSql);
      plan.application.executionAvailable = true;
    } catch (error) {
      plan.application.executionAvailable = false;
      plan.application.executionUnavailableReason =
        error instanceof Error ? error.message : "Unsupported query.";
    }
    this.bindings.set(plan.id, { plan, profile: { ...profile }, batchSql });
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
    const notify = (change: ExecutionOutcome) =>
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
      if (!current || !sameConnection(current, binding.profile))
        throw Error(
          "The connection changed. Run Explain again before executing.",
        );
      const { sql, kind } = executionQuery(binding.plan, binding.batchSql);
      if (abort.signal.aborted || !this.isCurrent(planId)) {
        notify({ status: "cancelled", error: "Execution was not started." });
        return;
      }
      const fresh = this.connections
        .profiles()
        .find((profile) => profile.id === current.id);
      if (!fresh || !sameConnection(fresh, binding.profile))
        throw Error("The connection changed. Run Explain again.");
      const password = await this.connections.password(current);
      if (abort.signal.aborted) throw Error("Execution cancelled.");
      notify({ status: "running" });
      const start = Date.now();
      started = true;
      const result = await this.collect(current, password, sql, abort.signal);
      const elapsedMs = Date.now() - start;
      const actual = databaseConnector(current.type).selectActual(
        result.raw,
        binding.plan,
        kind,
      );
      if (abort.signal.aborted) throw Error("Execution cancelled.");
      if (!actual.nodes.some((node) => node.actuals))
        throw Error("Query ran but no actual runtime counters were returned.");
      actual.id = planId + ":actual:" + requestId;
      actual.query = binding.plan.query;
      actual.application.planKind = "actual";
      actual.application.clientElapsedMs = elapsedMs;
      actual.application.connectionLabel = current.name;
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
