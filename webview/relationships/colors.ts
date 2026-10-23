export interface SchemaStyle {
  color: string;
  dashArray: string;
}
// Okabe–Ito colors, with theme-specific contrast adjustments in style.css.
// Pair colors with patterns so schema identity does not depend on hue alone.
export function schemaStyles(schemas: string[]): Map<string, SchemaStyle> {
  const patterns = [
    "",
    "12 5",
    "2 5",
    "12 4 2 4",
    "16 5 4 5",
    "5 4",
    "14 4 3 4 3 4",
  ];
  const used = new Set<number>();
  const result = new Map<string, SchemaStyle>();
  for (const schema of [...new Set(schemas)].sort()) {
    let hash = 2166136261;
    for (const character of schema)
      hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    let index = hash % 7;
    if (used.size < 7) while (used.has(index)) index = (index + 1) % 7;
    else index = 7 + result.size;
    used.add(index);
    const order = result.size;
    result.set(schema, {
      color: `var(--schema-palette-${index % 7})`,
      dashArray: patterns[order] ?? `12 4 ${6 + (order - 7) * 2} 4 2 4`,
    });
  }
  return result;
}
