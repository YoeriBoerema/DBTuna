import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { profileSchema, type Profile } from "./profile";
export async function configureConnection(
  existing?: Profile,
  onSpecialName?: (name: string) => Promise<boolean>,
) {
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
      { label: "Oracle Database", value: "oracle" as const },
    ],
    { placeHolder: "Connection type", ignoreFocusOut: true },
  );
  if (!typeChoice) return;
  const type = typeChoice.value;
  const previous = existing?.type === type ? existing : undefined;
  const name = await ask("Connection name", existing?.name);
  if (!existing && (await onSpecialName?.(name))) return;
  const host = await ask("Host", existing?.host || "localhost"),
    port = Number(
      await ask(
        "Port",
        String(
          previous?.port ||
            (type === "oracle" ? 1521 : type === "sqlserver" ? 1433 : 5432),
        ),
      ),
    ),
    database = await ask(
      type === "oracle" ? "Oracle service name / PDB (not SID)" : "Database",
      previous?.database ||
        (type === "oracle"
          ? "FREEPDB1"
          : type === "sqlserver"
            ? "master"
            : "postgres"),
    ),
    user = await ask("Username", previous?.user || "dbtuna");
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
  let currentSchema: string | undefined, walletLocation: string | undefined;
  if (type === "oracle") {
    const schema = await vscode.window.showInputBox({
      prompt: "Current schema (optional; blank uses the username)",
      value: existing?.type === "oracle" ? existing.currentSchema : undefined,
      ignoreFocusOut: true,
    });
    if (schema === undefined) return;
    currentSchema = schema.trim() || undefined;
    if (ssl.value === "verify") {
      const wallet = await vscode.window.showInputBox({
        prompt:
          "Directory containing unencrypted ewallet.pem (optional for one-way TCPS)",
        value:
          existing?.type === "oracle" ? existing.walletLocation : undefined,
        ignoreFocusOut: true,
      });
      if (wallet === undefined) return;
      walletLocation = wallet.trim() || undefined;
    }
  }
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
    ...(type === "oracle" ? { currentSchema, walletLocation } : {}),
  });
  return { profile: p, password };
}
