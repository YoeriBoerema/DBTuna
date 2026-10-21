export function decodePlan(bytes: Uint8Array): string {
  const data = Buffer.from(bytes);
  if (data[0] === 0xff && data[1] === 0xfe)
    return data.subarray(2).toString("utf16le");
  if (data[0] === 0xfe && data[1] === 0xff)
    return Buffer.from(data.subarray(2)).swap16().toString("utf16le");
  if (data[0] === 0x3c && data[1] === 0) return data.toString("utf16le");
  return data.toString("utf8");
}
