import { bounded, validate } from "../../plan-core/src/schema";
import type { QueryPlanAdapter } from "./adapter";
export class AdapterRegistry {
  constructor(private adapters: QueryPlanAdapter[]) {}
  parse(value: unknown) {
    const input = bounded(value);
    if (input && typeof input === "object" && "schemaVersion" in input)
      return validate(input);
    const adapter = this.adapters.find((a) => a.canParse(input));
    if (!adapter)
      throw Error(
        "Expected PostgreSQL JSON array containing one Plan, or DBTuna 1.0 JSON.",
      );
    return adapter.parse(input);
  }
}
