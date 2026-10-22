export const fmt = (v: unknown) =>
  v === undefined
    ? "Not available"
    : typeof v === "number"
      ? v.toLocaleString()
      : String(v);
