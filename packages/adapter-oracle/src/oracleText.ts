import { PLAN_LIMITS } from "../../plan-core/src/limits";
import type { OracleEnvelope } from "./oracleAdapter";

// Text is an import compatibility format only. Live collection always uses rows.
export function parseOracleText(text: string): OracleEnvelope {
  if (Buffer.byteLength(text) > PLAN_LIMITS.bytes)
    throw Error("Plan exceeds 5 MiB.");
  const rows: Record<string, unknown>[] = [],
    parents: { depth: number; id: number }[] = [];
  let header: string[] | undefined;
  const metric = (value: string | undefined) => {
    const match = value
      ?.trim()
      .replace(/,/g, "")
      .match(/^(\d+(?:\.\d+)?)\s*([KMG])?(?:\s|$)/i);
    return match
      ? Number(match[1]) *
          ({ K: 1000, M: 1e6, G: 1e9 }[match[2]?.toUpperCase() as "K"] || 1)
      : undefined;
  };
  for (const line of text.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells[0]?.trim() === "Id" && cells[1]?.trim() === "Operation") {
      if (header && rows.length)
        throw Error("Import one DBMS_XPLAN table at a time.");
      header = cells.map((c) => c.trim());
      continue;
    }
    if (!header || !/^\s*[*\-]?\s*\d+\s*$/.test(cells[0] || "")) continue;
    const id = Number(cells[0].replace(/[*\s-]/g, "")),
      operation = cells[1] || "",
      depth = operation.length - operation.trimStart().length;
    while (parents.length && parents.at(-1)!.depth >= depth) parents.pop();
    const get = (name: string) => cells[header!.indexOf(name)]?.trim();
    const row: Record<string, unknown> = {
      ID: id,
      PARENT_ID: parents.at(-1)?.id,
      OPERATION: operation.trim(),
      OBJECT_NAME: get("Name") || undefined,
      CARDINALITY: metric(get("E-Rows") || get("Rows")),
      BYTES: metric(get("Bytes")),
      COST: metric(get("Cost (%CPU)")),
      LAST_STARTS: metric(get("Starts")),
      LAST_OUTPUT_ROWS: metric(get("A-Rows")),
      "DBTuna imported text": true,
      "DBTuna inactive": cells[0].includes("-"),
    };
    const time = get("A-Time")?.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    if (time)
      row.LAST_ELAPSED_TIME =
        (Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])) * 1e6;
    rows.push(row);
    parents.push({ depth, id });
  }
  if (!rows.length)
    throw Error("Expected a DBMS_XPLAN table with Id and Operation columns.");
  for (const match of text.matchAll(
    /^\s*(\d+)\s*-\s*(access|filter)\((.*)\)\s*$/gim,
  )) {
    const row = rows.find((r) => r.ID === Number(match[1]));
    if (row) row[match[2].toUpperCase() + "_PREDICATES"] = match[3];
  }
  return {
    kind: "dbtuna-oracle-native",
    nativeVersion: 1,
    planKind: rows.some((r) => r.LAST_STARTS !== undefined)
      ? "actual"
      : "estimated",
    rows,
  };
}
