export type ObjectValue = Record<string, unknown>;
export const object = (value: unknown): value is ObjectValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
export const number = (value: unknown): number | undefined => {
  if (typeof value !== "number" && typeof value !== "string") return;
  if (value === "") return;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
};
// Properties are operator-local; never cross a native operator boundary.
export function entries(
  value: unknown,
  output: [string, unknown][] = [],
): [string, unknown][] {
  if (Array.isArray(value)) value.forEach((child) => entries(child, output));
  else if (object(value))
    for (const [key, child] of Object.entries(value)) {
      if (key === "RelOp" || key === "Plans") continue;
      output.push([key, child]);
      entries(child, output);
    }
  return output;
}
