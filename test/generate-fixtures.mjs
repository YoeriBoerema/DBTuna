import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("fixtures/postgres", { recursive: true });
mkdirSync("fixtures/invalid", { recursive: true });
const node = (type, extra = {}) => ({
  "Node Type": type,
  "Startup Cost": 0,
  "Total Cost": 100,
  "Plan Rows": 1000,
  "Plan Width": 32,
  ...extra,
});
const scan = node("Seq Scan", {
  "Relation Name": "orders",
  Alias: "o",
  Filter: "(status = 'active')",
});
const index = node("Index Scan", {
  "Relation Name": "customers",
  "Index Name": "customers_pkey",
  "Plan Rows": 1,
  "Total Cost": 0.5,
  "Index Cond": "(id = o.customer_id)",
});
const fixtures = {
  "seq-scan": scan,
  "index-scan": index,
  "nested-loop": node("Nested Loop", {
    "Join Type": "Inner",
    "Total Cost": 150,
    "Plan Rows": 100,
    Plans: [scan, index],
  }),
  "hash-join": node("Hash Join", {
    "Hash Cond": "(o.customer_id = c.id)",
    Plans: [scan, node("Hash", { Plans: [index] })],
  }),
  "sort-aggregate": node("Aggregate", {
    Plans: [node("Sort", { "Sort Key": ["customer_id"], Plans: [scan] })],
  }),
  bitmap: node("Bitmap Heap Scan", { Plans: [node("Bitmap Index Scan")] }),
  parallel: node("Gather", {
    Workers: 2,
    Plans: [node("Seq Scan", { "Parallel Aware": true })],
  }),
  cte: node("CTE Scan", {
    "CTE Name": "recent",
    Plans: [
      node("Seq Scan", {
        "Parent Relationship": "InitPlan",
        "Subplan Name": "CTE recent",
      }),
    ],
  }),
  unknown: node("Future Operator", { "Future Attribute": { kept: true } }),
};
for (const [name, Plan] of Object.entries(fixtures))
  writeFileSync(
    "fixtures/postgres/" + name + ".json",
    JSON.stringify([{ "DBTuna Synthetic": true, Plan }], null, 2),
  );
writeFileSync("fixtures/invalid/missing-plan.json", '[{"noPlan":true}]');
