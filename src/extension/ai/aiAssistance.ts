import * as vscode from "vscode";
import type { QueryPlan } from "../../../packages/plan-core/src/types";
import type { AiRequest, ExtensionToWebview } from "../webview/messages";
import { listModels, requestAdvice, validModel } from "./openaiClient";
const KEY = "dbtuna.openai.apiKey",
  MODEL = "ai.model";
export class AiAssistance {
  private active?: { id: string; abort: AbortController };
  constructor(
    private context: vscode.ExtensionContext,
    private findPlan: (id: string) => QueryPlan | undefined,
    private notify: (message: ExtensionToWebview) => void,
  ) {}
  async menu() {
    const selection = await vscode.window.showQuickPick(
      [
        {
          label: "Set API Key",
          command: "aiSetApiKey",
          description: "Stored in VS Code SecretStorage",
        },
        {
          label: "Select Model",
          command: "aiSelectModel",
          description:
            this.context.globalState.get<string>(MODEL) || "Not selected",
        },
        { label: "Remove API Key", command: "aiRemoveApiKey" },
      ],
      { title: "DBTuna: AI Assistance" },
    );
    if (selection)
      await vscode.commands.executeCommand("dbtuna." + selection.command);
  }
  async setKey() {
    const key = await vscode.window.showInputBox({
      title: "DBTuna: AI Assistance - API Key",
      prompt: "OpenAI API key (stored securely; never sent to the webview)",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        !value.trim() || value.trim().length > 4096 || /\s/.test(value.trim())
          ? "Enter an API key without spaces."
          : undefined,
    });
    if (key === undefined) return;
    this.cancel();
    await this.context.secrets.store(KEY, key.trim());
    void vscode.window.showInformationMessage(
      "DBTuna: OpenAI API key saved. Use AI Assistance: Select Model to choose a model.",
    );
  }
  async removeKey() {
    this.cancel();
    await this.context.secrets.delete(KEY);
    void vscode.window.showInformationMessage(
      "DBTuna: OpenAI API key removed.",
    );
  }
  async selectModel() {
    if (!vscode.workspace.isTrusted)
      throw Error("Trust the workspace before connecting to OpenAI.");
    const key = await this.context.secrets.get(KEY);
    let models: string[] = [];
    if (key) {
      try {
        models = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "DBTuna: Loading OpenAI models",
          },
          () => listModels(key),
        );
      } catch (error) {
        void vscode.window.showWarningMessage(
          error instanceof Error
            ? error.message
            : "Could not list models. Enter a model ID manually.",
        );
      }
    }
    const current = this.context.globalState.get<string>(MODEL);
    const chosen = await vscode.window.showQuickPick(
      [
        ...(current
          ? [{ label: current, description: "Current model", value: current }]
          : []),
        ...models
          .filter((id) => id !== current)
          .map((id) => ({ label: id, value: id })),
        {
          label: "Enter model ID manually...",
          description: "Use a text model supporting the Responses API",
          value: "manual",
        },
      ],
      {
        title: "DBTuna: AI Assistance - Select Model",
        placeHolder: key
          ? "Account models; endpoint compatibility depends on the model"
          : "Set an API key to load account models, or enter a model ID",
      },
    );
    if (!chosen) return;
    const model =
      chosen.value === "manual"
        ? await vscode.window.showInputBox({
            title: "OpenAI model ID",
            value: current,
            validateInput: (v) =>
              validModel(v.trim()) ? undefined : "Enter a valid model ID.",
          })
        : chosen.value;
    if (model === undefined) return;
    this.cancel();
    await this.context.globalState.update(MODEL, model.trim());
    void vscode.window.showInformationMessage(
      "DBTuna: AI model set to " + model.trim() + ".",
    );
  }
  cancel(id?: string) {
    if (!id || this.active?.id === id) this.active?.abort.abort();
  }
  async analyze(message: AiRequest) {
    const abort = new AbortController();
    this.cancel();
    this.active = { id: message.requestId, abort };
    const response = {
      type: "AI_RESULT" as const,
      requestId: message.requestId,
      planId: message.planId,
      nodeId: message.nodeId,
    };
    try {
      if (!vscode.workspace.isTrusted)
        throw Error("Trust the workspace before sending queries to OpenAI.");
      const plan = this.findPlan(message.planId);
      if (!plan)
        throw Error("This plan is no longer active. Run Explain again.");
      const key = await this.context.secrets.get(KEY),
        model = this.context.globalState.get<string>(MODEL);
      if (!key)
        throw Error("Set your OpenAI API key in DBTuna: AI Assistance first.");
      if (!model) throw Error("Select a model in DBTuna: AI Assistance first.");
      const result = await requestAdvice(
        key,
        model,
        {
          plan,
          nodeId: message.nodeId,
          context: message.context,
          query: message.query,
        },
        abort.signal,
      );
      if (abort.signal.aborted) throw Error("AI request cancelled.");
      this.notify({ ...response, ...result });
    } catch (error) {
      this.notify({
        ...response,
        error: abort.signal.aborted
          ? "AI request cancelled."
          : error instanceof Error
            ? error.message
            : "AI advice failed.",
      });
    } finally {
      if (this.active?.abort === abort) this.active = undefined;
    }
  }
  dispose() {
    this.cancel();
  }
}
