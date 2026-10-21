import { XMLParser, XMLValidator, XMLBuilder } from "fast-xml-parser";
import { decodeXmlValue } from "./xmlValues";
const xmlValueOptions = {
  // Showplan adds wrapper elements around each operator in a deep join tree.
  maxNestedTags: 512,
  processEntities: false,
  attributeValueProcessor: (_name: string, value: string) =>
    decodeXmlValue(value),
  tagValueProcessor: (_name: string, value: string) => decodeXmlValue(value),
};
import {
  bounded,
  validate,
  type QueryPlan,
  type PlanNode,
  type OperatorCategory,
} from "../../plan-core/src/schema";
import type { QueryPlanAdapter } from "../../adapter-sdk/src/adapter";
type Native = Record<string, unknown>;
const record = (v: unknown): v is Native =>
  !!v && typeof v === "object" && !Array.isArray(v);
function category(name: string): OperatorCategory {
  if (/Join|Nested Loops|Adaptive Join/i.test(name)) return "JOIN";
  if (/Seek|Lookup|Index Scan/i.test(name)) return "INDEX_ACCESS";
  if (/Constant Scan/i.test(name)) return "OTHER";
  if (/Scan/i.test(name)) return "TABLE_SCAN";
  if (/Sort/i.test(name)) return "SORT";
  if (/Aggregate/i.test(name)) return "AGGREGATE";
  if (/Hash/i.test(name)) return "HASH";
  if (/Parallelism|Exchange/i.test(name)) return "PARALLEL";
  if (/Spool/i.test(name)) return "MATERIALIZE";
  if (/Concatenation/i.test(name)) return "APPEND";
  if (/Top/i.test(name)) return "LIMIT";
  return "OTHER";
}
// Find immediate RelOp descendants, stopping at each operator boundary.
function children(v: unknown): Native[] {
  if (Array.isArray(v)) return v.flatMap(children);
  if (!record(v)) return [];
  return Object.entries(v).flatMap(([key, value]) =>
    key === "RelOp"
      ? (Array.isArray(value) ? value : [value]).filter(record)
      : children(value),
  );
}
function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(prune);
  if (!record(v)) return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([k]) => k !== "RelOp")
      .map(([k, x]) => [k, prune(x)]),
  );
}
function find(v: unknown, key: string): Native | undefined {
  if (Array.isArray(v)) {
    for (const x of v) {
      const found = find(x, key);
      if (found) return found;
    }
  } else if (record(v)) {
    if (record(v[key])) return v[key];
    for (const [k, x] of Object.entries(v))
      if (k !== "RelOp") {
        const found = find(x, key);
        if (found) return found;
      }
  }
}
export class SqlServerAdapter implements QueryPlanAdapter {
  readonly id = "sqlserver";
  readonly displayName = "SQL Server";
  canParse(v: unknown) {
    return typeof v === "string" && /<(?:[\w-]+:)?ShowPlanXML\b/.test(v);
  }
  parseStatements(input: unknown): QueryPlan[] {
    const combined = this.parse(input); // Validate and bound the entire native document first.
    const document = new XMLParser({
      ignoreAttributes: false,
      ...xmlValueOptions,
      removeNSPrefix: true,
    }).parse(input as string) as Native;
    const top = document.ShowPlanXML as Native;
    const statements: Native[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!record(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "StmtSimple") {
          for (const statement of Array.isArray(child) ? child : [child]) {
            if (record(statement) && children(statement).length)
              statements.push(statement);
          }
        } else visit(child);
      }
    };
    visit(top);
    if (!statements.length) return [combined];
    if (statements.length > 20)
      throw Error("Explain at most 20 statements at a time.");
    const builder = new XMLBuilder({
      maxNestedTags: 512,
      ignoreAttributes: false,
      suppressBooleanAttributes: false,
    });
    return statements.map((statement, index) => {
      const plan = this.parse(
        builder.build({
          ShowPlanXML: {
            ...top,
            "@_xmlns":
              "http://schemas.microsoft.com/sqlserver/2004/07/showplan",
            BatchSequence: { Batch: { Statements: { StmtSimple: statement } } },
          },
        }),
      );
      plan.id += ":" + (index + 1);
      plan.query = String(statement["@_StatementText"] ?? "");
      plan.metadata.statementIndex = index + 1;
      plan.metadata.statementType = String(statement["@_StatementType"] ?? "");
      return plan;
    });
  }
  parse(input: unknown): QueryPlan {
    if (!this.canParse(input) || typeof input !== "string")
      throw Error("Expected SQL Server Showplan XML.");
    if (Buffer.byteLength(input) > 5 * 1024 * 1024)
      throw Error("Plan exceeds 5 MiB.");
    if (/<!DOCTYPE|<!ENTITY/i.test(input))
      throw Error("XML DTDs and entity declarations are not supported.");
    if (XMLValidator.validate(input) !== true)
      throw Error("Invalid Showplan XML.");
    const document = bounded(
      new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "",
        removeNSPrefix: true,
        parseAttributeValue: false,
        ...xmlValueOptions,
      }).parse(input),
    ) as Native;
    const top = document.ShowPlanXML;
    if (!record(top)) throw Error("Missing ShowPlanXML root.");
    const nodes: PlanNode[] = [],
      edges: QueryPlan["edges"] = [],
      roots: string[] = [];
    const walk = (raw: Native, parent?: string) => {
      if (nodes.length >= 1000) throw Error("Maximum 1000 operators.");
      if (typeof raw.PhysicalOp !== "string")
        throw Error("Missing PhysicalOp.");
      const id = String(nodes.length);
      const number = (key: string) => {
        if (raw[key] === undefined) return undefined;
        const value = Number(raw[key]);
        if (!Number.isFinite(value) || value < 0)
          throw Error("Invalid SQL Server metric: " + key);
        return value;
      };
      const object = find(raw, "Object");
      const str = (key: string) =>
        typeof object?.[key] === "string" ? (object[key] as string) : undefined;
      const runtime = find(raw, "RunTimeInformation");
      const counters = runtime?.RunTimeCountersPerThread;
      const threads = (
        Array.isArray(counters) ? counters : counters ? [counters] : []
      ).filter(record);
      const metric = (key: string, aggregation: "sum" | "max" = "sum") => {
        if (
          !threads.length ||
          threads.some((thread) => thread[key] === undefined)
        )
          return undefined;
        const values = threads.map((thread) => Number(thread[key]));
        if (values.some((value) => !Number.isFinite(value) || value < 0))
          throw Error("Invalid actual SQL Server metric.");
        return aggregation === "max"
          ? Math.max(...values)
          : values.reduce((sum, value) => sum + value, 0);
      };
      nodes.push({
        id,
        nativeType: raw.PhysicalOp,
        label: raw.PhysicalOp,
        category: category(raw.PhysicalOp + " " + String(raw.LogicalOp ?? "")),
        object: object
          ? {
              schema: str("Schema"),
              relation: str("Table"),
              index: str("Index"),
              alias: str("Alias"),
            }
          : undefined,
        estimates: {
          totalCost: number("EstimatedTotalSubtreeCost"),
          rows: number("EstimateRows"),
          rowWidth: number("AvgRowSize"),
          cpuCost: number("EstimateCPU"),
          ioCost: number("EstimateIO"),
          costScope: "subtree",
        },
        actuals: threads.length
          ? {
              rows: metric("ActualRows"),
              loops: metric("ActualExecutions"),
              rowsScope: "total",
              elapsedTimeMs: metric("ActualElapsedms", "max"),
              cpuTimeMs: metric("ActualCPUms"),
            }
          : undefined,
        properties: prune(raw) as Native,
      });
      if (parent)
        edges.push({ id: parent + ">" + id, source: parent, target: id });
      else roots.push(id);
      for (const child of children(raw)) walk(child, id);
    };
    for (const root of children(top)) walk(root);
    if (!nodes.length)
      throw Error(
        "SQL Server returned no graphical operators. Temporary tables and some statement types cannot be planned without execution.",
      );
    return validate({
      schemaVersion: "1.0",
      id: "sqlserver-plan",
      database: { engine: "sqlserver", version: String(top.Build ?? "") },
      source: {
        format: "sqlserver-showplan-xml",
        synthetic: top.DBTunaSynthetic === "true",
      },
      rootNodeIds: roots,
      nodes,
      edges,
      metadata: {
        ...(prune(top) as Native),
        costMeaning:
          "SQL Server estimated subtree cost; optimizer units, not milliseconds",
        nativeXml: input,
      },
    });
  }
}
