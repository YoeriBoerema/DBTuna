import { z } from "zod";
const common = {
  id: z.string().min(1),
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1),
  user: z.string().min(1),
};
const postgresProfileSchema = z
  .object({
    ...common,
    type: z.literal("postgresql"),
    ssl: z.enum(["disable", "verify"]),
    authentication: z.never().optional(),
    domain: z.never().optional(),
  })
  .strict();
const sqlServerProfileSchema = z
  .object({
    ...common,
    type: z.literal("sqlserver"),
    ssl: z.enum(["disable", "verify", "trust"]),
    authentication: z.enum(["default", "ntlm"]).optional(),
    domain: z.string().optional(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (profile.authentication === "ntlm" && !profile.domain?.trim())
      ctx.addIssue({ code: "custom", message: "NTLM requires a domain" });
  });
export const profileSchema = z.discriminatedUnion("type", [
  postgresProfileSchema,
  sqlServerProfileSchema,
  z
    .object({
      ...common,
      type: z.literal("oracle"),
      ssl: z.enum(["disable", "verify"]),
      authentication: z.never().optional(),
      domain: z.never().optional(),
      currentSchema: z.string().min(1).optional(),
      walletLocation: z.string().min(1).optional(),
    })
    .strict(),
]);
export type Profile = z.infer<typeof profileSchema>;
// Compare only connection configuration. Field order and serialization do not define identity.
export function sameConnection(left: Profile, right: Profile): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.type === right.type &&
    left.host === right.host &&
    left.port === right.port &&
    left.database === right.database &&
    left.user === right.user &&
    left.ssl === right.ssl &&
    left.authentication === right.authentication &&
    left.domain === right.domain &&
    (left.type !== "oracle" ||
      right.type !== "oracle" ||
      (left.currentSchema === right.currentSchema &&
        left.walletLocation === right.walletLocation))
  );
}
