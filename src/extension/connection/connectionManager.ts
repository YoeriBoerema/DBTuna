import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Profile, clientConfig, withClient } from "./postgresClient";
import { testSqlServer } from "./sqlServerClient";
import { profileSchema } from "./profile";
export class ConnectionManager {
  constructor(private context: vscode.ExtensionContext) {}
  async initialize() {
    if (this.context.globalState.get("connectionSchema") === 2) return;
    const old = this.context.globalState.get<{ id?: string }[]>(
      "connections",
      [],
    );
    for (const p of old)
      if (p.id) await this.context.secrets.delete("dbtuna.password." + p.id);
    await this.context.globalState.update("connections", []);
    await this.context.globalState.update("activeConnection", undefined);
    await this.context.globalState.update("connectionSchema", 2);
  }
  async password(p: Profile) {
    return this.context.secrets.get("dbtuna.password." + p.id);
  }
  profiles() {
    return z
      .array(profileSchema)
      .parse(this.context.globalState.get("connections", []));
  }
  async config(p: Profile) {
    return clientConfig(
      p,
      await this.context.secrets.get("dbtuna.password." + p.id),
    );
  }
  async choose() {
    const list = this.profiles();
    const chosen = await vscode.window.showQuickPick(
      [
        ...list.map((p) => ({
          label: p.name,
          description: p.type + " | " + p.host + "/" + p.database,
          id: p.id,
        })),
        { label: "$(add) Add connection", id: "add" },
      ],
      { placeHolder: "Select a database connection" },
    );
    if (!chosen) return;
    const p =
      chosen.id === "add"
        ? await this.edit()
        : list.find((p) => p.id === chosen.id);
    if (p) await this.context.globalState.update("activeConnection", p.id);
    return p;
  }
  async active() {
    return (
      this.profiles().find(
        (p) => p.id === this.context.globalState.get("activeConnection"),
      ) || (await this.choose())
    );
  }
  async edit(existing?: Profile) {
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
    await this.context.secrets.store("dbtuna.password." + p.id, password);
    await this.context.globalState.update("connections", [
      ...this.profiles().filter((x) => x.id !== p.id),
      p,
    ]);
    await this.context.globalState.update("activeConnection", p.id);
    return p;
  }
  async manage() {
    const p = await this.choose();
    if (!p) return;
    const action = await vscode.window.showQuickPick([
      "Test Connection",
      "Update Connection",
      "Remove Connection",
    ]);
    if (action === "Update Connection") return this.edit(p);
    if (action === "Test Connection") {
      if (!vscode.workspace.isTrusted)
        throw Error("Trust the workspace first.");
      if (p.type === "sqlserver")
        await testSqlServer(p, await this.password(p));
      else
        await withClient(await this.config(p), async (c) => {
          await c.query("SELECT 1");
        });
      void vscode.window.showInformationMessage(
        "DBTuna: Connection succeeded.",
      );
    }
    if (action === "Remove Connection") {
      await this.context.globalState.update(
        "connections",
        this.profiles().filter((x) => x.id !== p.id),
      );
      await this.context.secrets.delete("dbtuna.password." + p.id);
      if (this.context.globalState.get("activeConnection") === p.id)
        await this.context.globalState.update("activeConnection", undefined);
    }
  }
}
