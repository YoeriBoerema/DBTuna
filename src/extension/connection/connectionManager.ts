import * as vscode from "vscode";
import { clientConfig, withClient } from "./postgresClient";
import { testSqlServer } from "./sqlServerClient";
import type { Profile } from "./profile";
import { ProfileRepository } from "./profileRepository";
import { configureConnection } from "./connectionWizard";
export class ConnectionManager {
  private repository: ProfileRepository;
  constructor(context: vscode.ExtensionContext) {
    this.repository = new ProfileRepository(
      context.globalState,
      context.secrets,
    );
  }
  initialize() {
    return this.repository.initialize();
  }
  password(profile: Profile) {
    return this.repository.password(profile);
  }
  profiles() {
    return this.repository.profiles();
  }
  async config(profile: Profile) {
    return clientConfig(profile, await this.password(profile));
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
    if (p) await this.repository.select(p);
    return p;
  }

  async active() {
    return this.repository.active() || (await this.choose());
  }
  async edit(existing?: Profile) {
    const result = await configureConnection(existing);
    if (!result) return;
    await this.repository.save(result.profile, result.password);
    return result.profile;
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
    if (action === "Remove Connection") await this.repository.remove(p);
  }
}
