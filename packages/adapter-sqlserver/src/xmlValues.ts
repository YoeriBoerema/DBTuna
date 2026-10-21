// Decode one XML layer, after parsing has identified attribute/text boundaries.
// In particular, &amp;#xd; is literal SQL text and must NOT become a line break.
export function decodeXmlValue(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  return value.replace(
    /&(?:#x([0-9a-fA-F]+)|#([0-9]+)|(amp|lt|gt|quot|apos));/g,
    (
      _,
      hex: string | undefined,
      decimal: string | undefined,
      name: string | undefined,
    ) => {
      if (name) return named[name];
      const point = Number.parseInt(hex ?? decimal!, hex ? 16 : 10);
      if (!(
        point === 9 ||
        point === 10 ||
        point === 13 ||
        (point >= 32 && point <= 0xd7ff) ||
        (point >= 0xe000 && point <= 0xfffd) ||
        (point >= 0x10000 && point <= 0x10ffff)
      ))
        throw Error("Invalid XML character reference in SQL Server plan.");
      return String.fromCodePoint(point);
    },
  );
}
