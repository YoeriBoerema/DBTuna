import { entries, object, number } from "./native";
import type { NodeFacts } from "./factTypes";
const list = (value: unknown) =>
  (Array.isArray(value) ? value : [value]).filter(object);
export function extractMissingIndexes(
  metadata: Record<string, unknown>,
): NodeFacts["missingIndexes"] {
  const candidates: NodeFacts["missingIndexes"] = [];
  for (const [key, value] of entries(metadata)) {
    if (key !== "MissingIndexGroup") continue;
    for (const group of list(value))
      for (const index of list(group.MissingIndex)) {
        if (typeof index.Table !== "string") continue;
        const candidate: NodeFacts["missingIndexes"][number] = {
          relation: [index.Database, index.Schema, index.Table]
            .filter((part) => typeof part === "string")
            .join("."),
          equality: [],
          inequality: [],
          include: [],
        };
        for (const columns of list(index.ColumnGroup)) {
          const target =
            columns.Usage === "EQUALITY"
              ? candidate.equality
              : columns.Usage === "INEQUALITY"
                ? candidate.inequality
                : columns.Usage === "INCLUDE"
                  ? candidate.include
                  : undefined;
          if (!target) continue;
          for (const column of list(columns.Column))
            if (typeof column.Name === "string") target.push(column.Name);
        }
        const impact = number(group.Impact);
        if (impact !== undefined && impact <= 100) candidate.impact = impact;
        if (candidate.equality.length || candidate.inequality.length)
          candidates.push(candidate);
      }
  }
  return candidates;
}
