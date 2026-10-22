import { z } from "zod";
import { AI_LIMITS } from "./limits";
export const adviceSchema = z
  .object({
    score: z.number().int().min(1).max(100),
    scoreReason: z.string().trim().min(1).max(AI_LIMITS.scoreReasonCharacters),
    suggestions: z
      .array(z.string().trim().min(1).max(AI_LIMITS.suggestionCharacters))
      .max(AI_LIMITS.suggestions),
    updatedQuery: z
      .string()
      .trim()
      .min(1)
      .max(AI_LIMITS.queryCharacters)
      .nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.suggestions.length && !value.updatedQuery)
      ctx.addIssue({
        code: "custom",
        message: "Suggestions require a complete proposed query.",
      });
    if (!value.suggestions.length && value.updatedQuery !== null)
      ctx.addIssue({
        code: "custom",
        message: "No query is needed without suggestions.",
      });
  });
export type Advice = z.infer<typeof adviceSchema>;
export function parseAdvice(value: unknown): Advice {
  const result = adviceSchema.safeParse(value);
  if (!result.success)
    throw Error(
      "AI returned an invalid score or suggestions format. Try again.",
    );
  return result.data;
}
