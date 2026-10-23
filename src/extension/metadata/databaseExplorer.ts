import * as vscode from "vscode";
import { ConnectionManager } from "../connection/connectionManager";
import type { Profile } from "../connection/profile";
import { readMetadata } from "./readMetadata";
import {
  MetadataLimitError,
  type MetadataKind,
  type MetadataScope,
} from "./catalog";
interface ExplorerNode {
  id: string;
  label: string;
  profile?: Profile;
  kind?: MetadataKind;
  scope: MetadataScope;
  detail?: string;
  leaf?: boolean;
  table?: boolean;
}
const folders: [MetadataKind, string][] = [
  ["columns", "Columns"],
  ["primaryKeys", "Primary keys"],
  ["foreignKeys", "Foreign keys"],
  ["uniqueKeys", "Unique constraints"],
  ["indexes", "Indexes"],
];
export class DatabaseExplorer
  implements vscode.TreeDataProvider<ExplorerNode>, vscode.Disposable
{
  private changed = new vscode.EventEmitter<ExplorerNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private cache = new Map<string, ExplorerNode[]>();
  private pending = new Map<string, Promise<ExplorerNode[]>>();
  private requests = new Set<AbortController>();
  private generation = 0;
  constructor(
    private connections: Pick<ConnectionManager, "profiles" | "password">,
    private load: typeof readMetadata = readMetadata,
  ) {}
  refresh() {
    this.generation++;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.cache.clear();
    this.pending.clear();
    this.changed.fire(undefined);
  }
  dispose() {
    this.refresh();
    this.changed.dispose();
  }
  getTreeItem(node: ExplorerNode) {
    const item = new vscode.TreeItem(
      node.label,
      node.leaf
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = node.id;
    if (node.profile && node.kind === "schemas")
      item.contextValue = "dbtuna.database";
    if (node.id === "empty")
      item.command = {
        command: "dbtuna.addConnection",
        title: "Add connection",
      };
    item.description = node.detail;
    item.tooltip = node.detail ? `${node.label}\n${node.detail}` : node.label;
    item.iconPath = new vscode.ThemeIcon(
      node.leaf
        ? "symbol-field"
        : node.table
          ? "table"
          : node.kind === "schemas"
            ? "database"
            : "folder",
    );
    return item;
  }
  async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
    if (!node) {
      const profiles = this.connections.profiles();
      if (!profiles.length)
        return [
          {
            id: "empty",
            label: "Add a connection to browse metadata",
            scope: {},
            leaf: true,
          },
        ];
      return profiles.map((profile) => ({
        id: JSON.stringify([profile.id]),
        label: profile.name,
        detail: `${profile.type} · ${profile.database}`,
        profile,
        kind: "schemas",
        scope: {},
      }));
    }
    if (node.leaf || !node.profile) return [];
    if (!vscode.workspace.isTrusted)
      return [
        {
          id: node.id + ":trust",
          label: "Trust the workspace to browse database metadata",
          scope: {},
          leaf: true,
        },
      ];
    if (node.table)
      return folders.map(([kind, label]) => ({
        ...node,
        id: JSON.stringify([
          node.profile!.id,
          node.scope.schema,
          node.scope.table,
          kind,
        ]),
        label,
        kind,
        table: false,
        detail: undefined,
      }));
    const key = node.id;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const generation = this.generation;
    const request = new AbortController();
    this.requests.add(request);
    const operation = (async () => {
      try {
        const entries = await this.load(
          node.profile!,
          await this.connections.password(node.profile!),
          node.kind!,
          node.scope,
          request.signal,
        );
        if (generation !== this.generation) return [];
        const children: ExplorerNode[] = entries.map((entry) => {
          const schema = node.kind === "schemas";
          const table = node.kind === "tables";
          return {
            id: JSON.stringify([key, entry.name]),
            label: entry.name,
            detail: entry.detail,
            profile: node.profile,
            scope: schema
              ? { schema: entry.name }
              : table
                ? { ...node.scope, table: entry.name }
                : node.scope,
            kind: schema ? "tables" : undefined,
            table,
            leaf: !schema && !table,
          };
        });
        if (!children.length)
          children.push({
            id: key + ":empty",
            label: "No visible objects (permissions may limit results)",
            scope: {},
            leaf: true,
          });
        this.cache.set(key, children);
        return children;
      } catch (error) {
        if (request.signal.aborted || generation !== this.generation) return [];
        // Driver errors can include connection details. Keep them out of tree labels/logs.
        return [
          {
            id: key + ":error",
            label:
              error instanceof MetadataLimitError
                ? error.message
                : "Could not read metadata — check connection/permissions, then Refresh",
            scope: {},
            leaf: true,
          },
        ];
      } finally {
        this.requests.delete(request);
        if (generation === this.generation) this.pending.delete(key);
      }
    })();
    this.pending.set(key, operation);
    return operation;
  }
}
