const UNITS: Record<string, number> = {
  "": 1,
  b: 1,
  k: 1024,
  kb: 1024,
  kib: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
};

/** 解析人类可读体积为字节数。纯数字按字节，支持 b/kb/mb/gb（1KB=1024）。 */
export function parseSize(input: string): number {
  const m = String(input).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!m) throw new Error(`invalid size: ${JSON.stringify(input)}`);
  const value = parseFloat(m[1]!);
  const unit = m[2]!;
  const mult = UNITS[unit];
  if (mult == null) throw new Error(`invalid size unit: ${JSON.stringify(unit)}`);
  return Math.round(value * mult);
}

/** 字节数格式化为人类可读字符串。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)}${units[i]}`;
}
