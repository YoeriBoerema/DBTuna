import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { profileSchema, type Profile } from "./profile";
export async function configureConnection(existing?: Profile) {
  if (!vscode.workspace.isTrusted)
    throw Error("Trust this workspace before configuring connections.");
  const ask = async (prompt: string, value?: string, password = false) => {
    const result = await vscode.window.showInputBox({
      prompt,
      value,
      password,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : "Required"),
    });
    if (result === undefined) throw Error("Connection setup cancelled.");
    return result;
  };
  const typeChoice = await vscode.window.showQuickPick(
    [
      { label: "PostgreSQL", value: "postgresql" as const },
      { label: "SQL Server", value: "sqlserver" as const },
    ],
    { placeHolder: "Connection type", ignoreFocusOut: true },
  );
  if (!typeChoice) return;
  const type = typeChoice.value;
  const name = await ask("Connection name", existing?.name),
    host = await ask("Host", existing?.host || "localhost"),
    port = Number(
      await ask(
        "Port",
        String(existing?.port || (type === "sqlserver" ? 1433 : 5432)),
      ),
    ),
    database = await ask(
      "Database",
      existing?.database || (type === "sqlserver" ? "master" : "postgres"),
    ),
    user = await ask(
      "Username",
      existing?.user || (type === "sqlserver" ? "sa" : "postgres"),
    );
  let authentication: "default" | "ntlm" | undefined;
  let domain: string | undefined;
  if (type === "sqlserver") {
    const auth = await vscode.window.showQuickPick(
      [
        { label: "SQL Server username/password", value: "default" as const },
        {
          label: "Windows domain credentials (NTLM)",
          value: "ntlm" as const,
        },
      ],
      { placeHolder: "Authentication (NTLM uses explicit credentials)" },
    );
    if (!auth) return;
    authentication = auth.value;
    if (authentication === "ntlm")
      domain = await ask("Windows domain", existing?.domain);
  }
  const ssl = await vscode.window.showQuickPick(
    [
      { label: "Verify TLS certificate", value: "verify" as const },
      ...(type === "sqlserver"
        ? [
            {
              label: "Encrypt; trust server certificate (development)",
              value: "trust" as const,
            },
          ]
        : []),
      { label: "Disable TLS (local development)", value: "disable" as const },
    ],
    { placeHolder: "SSL configuration" },
  );
  if (!ssl) return;
  const password = await ask(
    "Password (stored in VS Code SecretStorage)",
    undefined,
    true,
  );
  const p = profileSchema.parse({
    id: existing?.id || randomUUID(),
    type,
    authentication,
    domain,
    name,
    host,
    port,
    database,
    user,
    ssl: ssl.value,
  });
  return { profile: p, password };
}
