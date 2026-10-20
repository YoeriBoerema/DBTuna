import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Profile, clientConfig, withClient } from "./postgresClient";
import { profileSchema } from "./profile";
export class ConnectionManager {
  constructor(private context: vscode.ExtensionContext) {}
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
          description: p.host + "/" + p.database,
          id: p.id,
        })),
        { label: "$(add) Add connection", id: "add" },
      ],
      { placeHolder: "Select a PostgreSQL connection" },
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
    const name = await ask("Connection name", existing?.name),
      host = await ask("Host", existing?.host || "localhost"),
      port = Number(await ask("Port", String(existing?.port || 5432))),
      database = await ask("Database", existing?.database || "postgres"),
      user = await ask("Username", existing?.user || "postgres");
    const ssl = await vscode.window.showQuickPick(
      [
        { label: "Verify TLS certificate", value: "verify" as const },
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
