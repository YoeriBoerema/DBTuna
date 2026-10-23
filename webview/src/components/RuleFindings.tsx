import React, { useState } from "react";
import type { Analysis } from "../../../packages/plan-analysis/src/analyze";
import { fmt } from "../format";

export function RuleFindings({
  analysis,
  nodeId,
  onNavigate,
}: {
  analysis: Analysis;
  nodeId?: string;
  onNavigate: (id: string) => void;
}) {
  const [wholeQuery, setWholeQuery] = useState(!nodeId);
  const [shown, setShown] = useState(20);
  const findings = wholeQuery
    ? analysis.findings
    : analysis.findings.filter((finding) => finding.nodeIds.includes(nodeId!));
  return (
    <section className="rule-analysis" aria-label="Local plan analysis">
      <h3>Local plan analysis</h3>
      <p>
        {analysis.findings.length} findings in this query. Rules run locally
        without AI.
      </p>
      {nodeId && (
        <button
          onClick={() => {
            setWholeQuery(!wholeQuery);
            setShown(20);
          }}
        >
          {wholeQuery ? "Show selected operator" : "Show whole query"}
        </button>
      )}
      <p>
        {wholeQuery ? "Whole query" : "Selected operator"}: {findings.length}{" "}
        findings.
      </p>
      {!findings.length && (
        <p>No findings from the available rules and evidence.</p>
      )}
      {findings.slice(0, shown).map((finding) => (
        <article
          className="rule-finding"
          key={finding.ruleId + ":" + finding.nodeIds.join(",")}
          role="button"
          tabIndex={0}
          aria-label={`${finding.title}: highlight operator ${finding.nodeIds[0]}`}
          onClick={() => onNavigate(finding.nodeIds[0])}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onNavigate(finding.nodeIds[0]);
            }
          }}
        >
          <h4>{finding.title}</h4>
          <small>
            {finding.severity} · {finding.confidence} confidence · operator{" "}
            {finding.nodeIds.join(", ")}
          </small>
          <dl>
            {Object.entries(finding.evidence).map(([name, value]) => (
              <React.Fragment key={name}>
                <dt>{name}</dt>
                <dd>{typeof value === "number" ? fmt(value) : value}</dd>
              </React.Fragment>
            ))}
          </dl>
          <p>{finding.suggestion}</p>
          <p className="analysis-limitation">{finding.limitation}</p>
          <small>
            {finding.ruleId} · rule v{finding.ruleVersion}
          </small>
        </article>
      ))}
      {findings.length > shown && (
        <button onClick={() => setShown(shown + 20)}>Show more findings</button>
      )}
      <details>
        <summary>Analysis coverage and limitations</summary>
        {analysis.coverage.map((text) => (
          <p key={text}>{text}</p>
        ))}
        {analysis.ruleCoverage.map((rule) => (
          <p key={rule.ruleId}>
            {rule.ruleId}: evaluated {rule.evaluatedNodes}, skipped{" "}
            {rule.skippedNodes}.
            {rule.reasons.length > 0 ? " " + rule.reasons.join(" ") : ""}
          </p>
        ))}
      </details>
    </section>
  );
}
