export function postgresNative(properties = {}) {
  return [
    {
      Plan: {
        "Node Type": "Result",
        "Plan Rows": 1,
        "Total Cost": 1,
        ...properties,
      },
    },
  ];
}
// Inputs are test-owned XML fragments, deliberately allowing malformed fixtures.
export function sqlServerNative({
  operator = "Index Scan",
  estimate = 100,
  counters = "",
  warnings = "",
  statementWarnings = "",
  body = "",
} = {}) {
  return `<ShowPlanXML><BatchSequence><Batch><Statements>
    <StmtSimple StatementText="SELECT * FROM t" StatementType="SELECT"><QueryPlan>${statementWarnings}
    <RelOp PhysicalOp="${operator}" EstimateRows="${estimate}">
    ${counters ? `<RunTimeInformation>${counters}</RunTimeInformation>` : ""}${warnings}${body}
    </RelOp></QueryPlan></StmtSimple></Statements></Batch></BatchSequence></ShowPlanXML>`;
}
