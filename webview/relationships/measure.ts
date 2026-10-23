import type { DiagramTable } from "../../src/extension/metadata/relationshipGraph";
import type { TableSize } from "./layout";
// Measure the actual font, wrapped identifiers and row borders before layout.
export function measureTables(tables: DiagramTable[]): Map<string, TableSize> {
  const container = document.createElement("div");
  container.style.cssText =
    "position:absolute;visibility:hidden;left:-10000px;top:0;pointer-events:none";
  document.body.append(container);
  const sizes = new Map<string, TableSize>();
  try {
    for (const table of tables) {
      const article = document.createElement("article");
      article.className = "table";
      const schema = document.createElement("small");
      schema.textContent =
        table.schema + (table.external ? " · referenced table" : "");
      const title = document.createElement("strong");
      title.textContent = table.name;
      const columns = document.createElement("div");
      columns.className = "columns";
      for (const name of table.columns) {
        const row = document.createElement("div");
        row.className = "column-row";
        const text = document.createElement("span");
        text.textContent = name;
        row.append(text);
        columns.append(row);
      }
      if (!table.columns.length) {
        const empty = document.createElement("em");
        empty.textContent = "No foreign-key columns";
        columns.append(empty);
      }
      article.append(schema, title, columns);
      container.append(article);
      const rect = article.getBoundingClientRect();
      const ports: Record<string, number> = Object.create(null);
      table.columns.forEach((name, index) => {
        const row = columns.children[index].getBoundingClientRect();
        ports[name] = row.y - rect.y + row.height / 2;
      });
      sizes.set(table.id, { width: rect.width, height: rect.height, ports });
      article.remove();
    }
  } finally {
    container.remove();
  }
  return sizes;
}
