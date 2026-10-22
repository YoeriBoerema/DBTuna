import type { Advice } from "../../packages/plan-core/src/advice";
export function formatAdvice(advice: Advice): string {
  return (
    `Score: ${advice.score}/100 (AI estimate). ${advice.scoreReason.replace(/\s+/g, " ")}\n\nSuggestions\n` +
    (advice.suggestions.length
      ? advice.suggestions
          .map((text) => "- " + text.replace(/\s+/g, " "))
          .join("\n")
      : "No easy improvements identified.") +
    (advice.suggestions.length
      ? `\n\nUpdated query (proposed)\n${advice.updatedQuery}`
      : "")
  );
}
