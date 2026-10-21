import { z } from "zod";
export const profileSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(["postgresql", "sqlserver"]),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    database: z.string().min(1),
    user: z.string().min(1),
    ssl: z.enum(["disable", "verify", "trust"]),
    authentication: z.enum(["default", "ntlm"]).optional(),
    domain: z.string().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (
      p.type === "postgresql" &&
      (p.ssl === "trust" || p.authentication || p.domain)
    )
      ctx.addIssue({ code: "custom", message: "Invalid PostgreSQL options" });
    if (p.authentication === "ntlm" && !p.domain?.trim())
      ctx.addIssue({ code: "custom", message: "NTLM requires a domain" });
  });
export type Profile = z.infer<typeof profileSchema>;
