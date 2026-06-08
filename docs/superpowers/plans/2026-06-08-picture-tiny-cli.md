# picture-tiny-cli Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个在 agent 中可靠调用的图片压缩 CLI（`ptiny`），能把图片压到目标文件体积和/或目标像素尺寸，在满足约束的前提下最小程度影响画质，stdout 始终输出纯 JSON。

**Architecture:** bun 直接执行 TypeScript，sharp（libvips）做编解码。命中目标体积用「二分搜索质量参数」（内存内 `toBuffer()` 反复编码，取 ≤目标的最高质量）；尺寸约束先 resize（默认不放大）。按单一职责拆成 `size/args/inputs/format/compress/output/run/cli` 模块，TDD 用 `bun test`，测试图程序化生成。

**Tech Stack:** bun 1.3+、sharp、内置 `util.parseArgs`、`Bun.Glob`、`bun test`。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `package.json` | 包元数据、`bin`、`sharp` 依赖、`test` 脚本 |
| `tsconfig.json` | 编辑器类型支持（验证仍以 `bun test` 为准） |
| `bin/ptiny` | `#!/usr/bin/env bun` 入口，转调 `src/cli.ts` |
| `src/size.ts` | 人类可读体积↔字节、字节格式化（纯函数） |
| `src/format.ts` | 格式归一化、编码器选择、各格式质量语义 |
| `src/compress.ts` | **核心**：buffer+选项 → buffer+元数据；resize + 二分质量 |
| `src/args.ts` | `util.parseArgs` 解析校验为强类型 `Options`；`UsageError` |
| `src/inputs.ts` | 文件/目录/glob 展开为去重图片路径列表 |
| `src/output.ts` | 依据选项解析单输入的输出路径 |
| `src/run.ts` | 单文件流水线 + 并发调度，产出 `FileResult` |
| `src/cli.ts` | 编排、统一 JSON 输出、退出码 |
| `src/index.ts` | 库 API 导出 |
| `tests/*.test.ts` | 各模块单测 + CLI 集成测试 |

约定：所有用户可读体积单位 1KB=1024、1MB=1024²；有损格式默认质量 82；PNG 命中体积用调色板量化，纯尺寸场景走无损。

---

## Task 0: 项目脚手架 + 退化 sharp 在 bun 下的风险

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bin/ptiny`
- Create: `tests/smoke.test.ts`

- [ ] **Step 1: 写 package.json**

```json
{
  "name": "picture-tiny-cli",
  "version": "0.1.0",
  "type": "module",
  "bin": { "ptiny": "bin/ptiny" },
  "module": "src/index.ts",
  "scripts": {
    "test": "bun test",
    "ptiny": "bun bin/ptiny"
  }
}
```

- [ ] **Step 2: 安装 sharp 与开发类型**

Run:
```bash
bun add sharp
bun add -d @types/bun
```
Expected: `node_modules/` 出现 `sharp` 与平台二进制（macOS arm64 下为 `node_modules/@img/sharp-darwin-arm64`），`package.json` 写入 `dependencies.sharp`。

> 若 sharp 加载失败（bun 报 native addon 错误），重试 `bun add sharp --force`，并确认 `node_modules/@img/` 下有对应平台包。这是唯一外部风险点，必须在本任务通过。

- [ ] **Step 3: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "module": "ESNext",
    "target": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": false
  }
}
```

- [ ] **Step 4: 写 bin/ptiny**

```ts
#!/usr/bin/env bun
import { main } from "../src/cli";

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stdout.write(JSON.stringify({ ok: false, error: (err as Error).message }) + "\n");
    process.exit(1);
  });
```

Run: `chmod +x bin/ptiny`

- [ ] **Step 5: 写退化 sharp 的 smoke 测试 `tests/smoke.test.ts`**

```ts
import { test, expect } from "bun:test";
import sharp from "sharp";

test("sharp encodes jpeg/png/webp under bun", async () => {
  const base = sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } },
  });
  const jpeg = await base.clone().jpeg({ quality: 80 }).toBuffer();
  const png = await base.clone().png().toBuffer();
  const webp = await base.clone().webp({ quality: 80 }).toBuffer();
  expect(jpeg.length).toBeGreaterThan(0);
  expect(png.length).toBeGreaterThan(0);
  expect(webp.length).toBeGreaterThan(0);
  expect((await sharp(jpeg).metadata()).format).toBe("jpeg");
});
```

- [ ] **Step 6: 运行 smoke 测试，确认 sharp 在 bun 下可用**

Run: `bun test tests/smoke.test.ts`
Expected: PASS（1 test）。若失败则按 Step 2 备注排查，不要继续后续任务。

- [ ] **Step 7: 提交**

```bash
printf 'node_modules/\ndist/\n*.log\n.DS_Store\n' > .gitignore
git add -A
git commit -m "chore: scaffold picture-tiny-cli, verify sharp works under bun"
```

---

## Task 1: size.ts — 体积解析与格式化

**Files:**
- Create: `src/size.ts`
- Test: `tests/size.test.ts`

- [ ] **Step 1: 写失败测试 `tests/size.test.ts`**

```ts
import { test, expect } from "bun:test";
import { parseSize, formatBytes } from "../src/size";

test("parseSize handles units (1KB=1024)", () => {
  expect(parseSize("500kb")).toBe(512000);
  expect(parseSize("1.5mb")).toBe(Math.round(1.5 * 1024 * 1024));
  expect(parseSize("200000")).toBe(200000);
  expect(parseSize("2 MB")).toBe(2 * 1024 * 1024);
  expect(parseSize("1gb")).toBe(1024 ** 3);
});

test("parseSize rejects invalid input", () => {
  expect(() => parseSize("abc")).toThrow();
  expect(() => parseSize("10xb")).toThrow();
  expect(() => parseSize("")).toThrow();
});

test("formatBytes is human readable", () => {
  expect(formatBytes(512)).toBe("512B");
  expect(formatBytes(1536)).toBe("1.5KB");
  expect(formatBytes(1024 * 1024)).toBe("1.0MB");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/size.test.ts`
Expected: FAIL（`Cannot find module '../src/size'`）。

- [ ] **Step 3: 实现 `src/size.ts`**

```ts
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
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/size.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/size.ts tests/size.test.ts
git commit -m "feat: add size parsing and formatting"
```

---

## Task 2: format.ts — 格式归一化与编码器

**Files:**
- Create: `src/format.ts`
- Test: `tests/format.test.ts`

- [ ] **Step 1: 写失败测试 `tests/format.test.ts`**

```ts
import { test, expect } from "bun:test";
import sharp from "sharp";
import { normalizeFormat, applyEncoder, DEFAULT_QUALITY, LOSSY_FORMATS } from "../src/format";

test("normalizeFormat maps aliases and rejects unknown", () => {
  expect(normalizeFormat("jpg")).toBe("jpeg");
  expect(normalizeFormat("JPEG")).toBe("jpeg");
  expect(normalizeFormat("png")).toBe("png");
  expect(normalizeFormat("webp")).toBe("webp");
  expect(normalizeFormat("avif")).toBe("avif");
  expect(() => normalizeFormat("bmp")).toThrow();
});

test("LOSSY_FORMATS contains lossy targets", () => {
  expect(LOSSY_FORMATS.has("jpeg")).toBe(true);
  expect(LOSSY_FORMATS.has("png")).toBe(false);
});

test("applyEncoder produces the requested format", async () => {
  const base = () =>
    sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } } });
  const jpeg = await applyEncoder(base(), "jpeg", 70).toBuffer();
  const webp = await applyEncoder(base(), "webp", 70).toBuffer();
  const pngLossless = await applyEncoder(base(), "png", null).toBuffer();
  const pngQuant = await applyEncoder(base(), "png", 50).toBuffer();
  expect((await sharp(jpeg).metadata()).format).toBe("jpeg");
  expect((await sharp(webp).metadata()).format).toBe("webp");
  expect((await sharp(pngLossless).metadata()).format).toBe("png");
  expect((await sharp(pngQuant).metadata()).format).toBe("png");
  expect(DEFAULT_QUALITY).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/format.test.ts`
Expected: FAIL（`Cannot find module '../src/format'`）。

- [ ] **Step 3: 实现 `src/format.ts`**

```ts
import type { Sharp } from "sharp";

export type TargetFormat = "jpeg" | "png" | "webp" | "avif";

export const DEFAULT_QUALITY = 82;
export const LOSSY_FORMATS = new Set<TargetFormat>(["jpeg", "webp", "avif"]);

/** 把格式字符串归一化为受支持的目标格式，未知格式抛错。 */
export function normalizeFormat(fmt: string): TargetFormat {
  const f = fmt.toLowerCase();
  if (f === "jpg" || f === "jpeg") return "jpeg";
  if (f === "png") return "png";
  if (f === "webp") return "webp";
  if (f === "avif") return "avif";
  throw new Error(`unsupported format: ${JSON.stringify(fmt)}`);
}

/**
 * 给 sharp pipeline 应用目标格式编码器。
 * - 有损格式：quality 为 null 时用 DEFAULT_QUALITY。
 * - png：quality 为 null 走无损；为数字走调色板量化。
 */
export function applyEncoder(pipeline: Sharp, format: TargetFormat, quality: number | null): Sharp {
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ quality: quality ?? DEFAULT_QUALITY, mozjpeg: true });
    case "webp":
      return pipeline.webp({ quality: quality ?? DEFAULT_QUALITY });
    case "avif":
      return pipeline.avif({ quality: quality ?? DEFAULT_QUALITY });
    case "png":
      return quality == null
        ? pipeline.png({ compressionLevel: 9 })
        : pipeline.png({ quality, palette: true, compressionLevel: 9 });
    default: {
      const never: never = format;
      throw new Error(`unsupported format: ${never}`);
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/format.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/format.ts tests/format.test.ts
git commit -m "feat: add format normalization and encoder selection"
```

---

## Task 3: compress.ts — 核心压缩（resize + 二分质量）

**Files:**
- Create: `src/compress.ts`
- Test: `tests/compress.test.ts`

- [ ] **Step 1: 写测试辅助与失败测试 `tests/compress.test.ts`**

```ts
import { test, expect } from "bun:test";
import sharp from "sharp";
import { compressImage, assertStatic } from "../src/compress";

/** 确定性伪噪声原始像素（避免纯色被压到极小，便于体积测试）。 */
function noiseRaw(w: number, h: number, channels: number): Buffer {
  const data = Buffer.alloc(w * h * channels);
  let x = 123456789;
  for (let i = 0; i < data.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    data[i] = x % 256;
  }
  return data;
}

async function noiseJpeg(w: number, h: number): Promise<Buffer> {
  return sharp(noiseRaw(w, h, 3), { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

async function noisePngAlpha(w: number, h: number): Promise<Buffer> {
  return sharp(noiseRaw(w, h, 4), { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
}

test("assertStatic rejects animated metadata", () => {
  expect(() => assertStatic(3)).toThrow(/animated/);
  expect(() => assertStatic(1)).not.toThrow();
  expect(() => assertStatic(undefined)).not.toThrow();
});

test("hits target file size with reachedTarget true", async () => {
  const big = await noiseJpeg(800, 800);
  const target = 30 * 1024;
  const res = await compressImage(big, { maxSize: target, minQuality: 1 });
  expect(res.buffer.length).toBeLessThanOrEqual(target);
  expect(res.reachedTarget).toBe(true);
  expect(res.quality).toBeGreaterThanOrEqual(1);
  expect(res.iterations).toBeGreaterThan(0);
});

test("resizes to max-side preserving aspect ratio", async () => {
  const img = await noiseJpeg(1000, 500);
  const res = await compressImage(img, { maxSide: 400, quality: 80 });
  expect(Math.max(res.width, res.height)).toBeLessThanOrEqual(400);
  expect(res.width).toBe(400);
  expect(res.height).toBe(200);
});

test("never upscales and warns", async () => {
  const img = await noiseJpeg(200, 200);
  const res = await compressImage(img, { width: 1000, quality: 80 });
  expect(res.width).toBe(200);
  expect(res.warnings.some((w) => /upscal/i.test(w))).toBe(true);
});

test("converts png to webp", async () => {
  const png = await noisePngAlpha(300, 300);
  const res = await compressImage(png, { format: "webp", quality: 80 });
  expect(res.format).toBe("webp");
  expect((await sharp(res.buffer).metadata()).format).toBe("webp");
});

test("flattens alpha when converting to jpeg", async () => {
  const png = await noisePngAlpha(120, 120);
  const res = await compressImage(png, { format: "jpeg", quality: 80, background: "#ffffff" });
  const meta = await sharp(res.buffer).metadata();
  expect(meta.format).toBe("jpeg");
  expect(meta.hasAlpha).toBe(false);
});

test("best effort when target is unreachable", async () => {
  const img = await noiseJpeg(1200, 1200);
  const res = await compressImage(img, { maxSize: 100, minQuality: 1 });
  expect(res.reachedTarget).toBe(false);
  expect(res.warnings.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/compress.test.ts`
Expected: FAIL（`Cannot find module '../src/compress'`）。

- [ ] **Step 3: 实现 `src/compress.ts`**

```ts
import sharp from "sharp";
import type { Sharp, ResizeOptions } from "sharp";
import {
  applyEncoder,
  normalizeFormat,
  DEFAULT_QUALITY,
  LOSSY_FORMATS,
  type TargetFormat,
} from "./format";

export interface CompressOptions {
  maxSize?: number; // 目标最大字节数
  width?: number;
  height?: number;
  maxSide?: number;
  quality?: number; // 固定质量 1-100
  format?: TargetFormat; // 显式目标格式
  background?: string; // alpha→jpeg 压平底色
  minQuality?: number; // 质量搜索下界，默认 1
}

export interface CompressResult {
  buffer: Buffer;
  format: TargetFormat;
  originalFormat: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  quality: number | null;
  targetBytes: number | null;
  reachedTarget: boolean;
  iterations: number;
  warnings: string[];
}

/** 多页（动图）保护：pages>1 抛错。 */
export function assertStatic(pages: number | undefined): void {
  if ((pages ?? 1) > 1) throw new Error("animated images are not supported in v1");
}

function clampQuality(q: number): number {
  return Math.max(1, Math.min(100, Math.round(q)));
}

/** 计算 resize 选项；不放大时返回 null 并记录 warning。 */
function planResize(
  opts: CompressOptions,
  ow: number,
  oh: number,
  warnings: string[],
): ResizeOptions | null {
  let width = opts.width;
  let height = opts.height;
  if (opts.maxSide != null) {
    width = Math.min(width ?? opts.maxSide, opts.maxSide);
    height = Math.min(height ?? opts.maxSide, opts.maxSide);
  }
  if (width == null && height == null) return null;
  const fitsW = width == null || width >= ow;
  const fitsH = height == null || height >= oh;
  if (fitsW && fitsH) {
    warnings.push("requested size is larger than or equal to original; not upscaling");
    return null;
  }
  return { width, height, fit: "inside", withoutEnlargement: true };
}

/**
 * 二分搜索质量：取 ≤target 的最高质量；都不满足时返回最小可得（best effort）。
 */
async function searchQuality(
  encode: (q: number) => Promise<Buffer>,
  targetBytes: number,
  minQuality: number,
): Promise<{ buffer: Buffer; quality: number; iterations: number; reached: boolean }> {
  let lo = Math.max(1, Math.min(100, Math.round(minQuality)));
  let hi = 100;
  let iterations = 0;
  let bestFit: { buffer: Buffer; quality: number } | null = null;
  let smallest: { buffer: Buffer; quality: number; size: number } | null = null;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    iterations++;
    const buf = await encode(mid);
    if (smallest == null || buf.length < smallest.size) {
      smallest = { buffer: buf, quality: mid, size: buf.length };
    }
    if (buf.length <= targetBytes) {
      if (bestFit == null || mid > bestFit.quality) bestFit = { buffer: buf, quality: mid };
      lo = mid + 1; // 体积达标，尝试更高质量
    } else {
      hi = mid - 1; // 超标，降质量
    }
  }

  if (bestFit) {
    return { buffer: bestFit.buffer, quality: bestFit.quality, iterations, reached: true };
  }
  return { buffer: smallest!.buffer, quality: smallest!.quality, iterations, reached: false };
}

/** 压缩单张图片：先 resize，再按约束选择固定质量 / 二分搜索 / 尺寸-only 编码。 */
export async function compressImage(
  input: Buffer,
  opts: CompressOptions,
): Promise<CompressResult> {
  const meta = await sharp(input, { failOn: "none" }).metadata();
  assertStatic(meta.pages);

  const originalFormat = meta.format ?? "unknown";
  const originalWidth = meta.width ?? 0;
  const originalHeight = meta.height ?? 0;
  const hasAlpha = meta.hasAlpha ?? false;
  const targetFormat: TargetFormat = opts.format ?? normalizeFormat(originalFormat);
  const warnings: string[] = [];
  const resize = planResize(opts, originalWidth, originalHeight, warnings);

  function buildPipeline(): Sharp {
    let p = sharp(input, { failOn: "none" });
    if (resize) p = p.resize(resize);
    if (targetFormat === "jpeg" && hasAlpha) {
      p = p.flatten({ background: opts.background ?? "#ffffff" });
    }
    return p;
  }

  const encode = (quality: number | null): Promise<Buffer> =>
    applyEncoder(buildPipeline(), targetFormat, quality).toBuffer();

  const targetBytes = opts.maxSize ?? null;
  let resultBuffer: Buffer;
  let chosenQuality: number | null;
  let iterations = 0;
  let reachedTarget = true;

  if (opts.quality != null) {
    chosenQuality = clampQuality(opts.quality);
    resultBuffer = await encode(chosenQuality);
  } else if (targetBytes != null) {
    const search = await searchQuality(
      (q) => encode(q),
      targetBytes,
      opts.minQuality ?? 1,
    );
    resultBuffer = search.buffer;
    chosenQuality = search.quality;
    iterations = search.iterations;
    reachedTarget = search.reached;
    if (!reachedTarget) {
      warnings.push(
        `could not reach target size; emitted best effort at quality ${chosenQuality}`,
      );
      if (targetFormat === "png") {
        warnings.push("consider --format webp for better compression of this image");
      }
    }
  } else {
    // 仅尺寸约束：有损用默认质量，png 走无损（quality=null）
    chosenQuality = LOSSY_FORMATS.has(targetFormat) ? DEFAULT_QUALITY : null;
    resultBuffer = await encode(chosenQuality);
  }

  const outMeta = await sharp(resultBuffer, { failOn: "none" }).metadata();
  return {
    buffer: resultBuffer,
    format: targetFormat,
    originalFormat,
    width: outMeta.width ?? originalWidth,
    height: outMeta.height ?? originalHeight,
    originalWidth,
    originalHeight,
    quality: chosenQuality,
    targetBytes,
    reachedTarget,
    iterations,
    warnings,
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/compress.test.ts`
Expected: PASS（7 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/compress.ts tests/compress.test.ts
git commit -m "feat: add core image compression with binary-search quality"
```

---

## Task 4: args.ts — CLI 参数解析与校验

**Files:**
- Create: `src/args.ts`
- Test: `tests/args.test.ts`

- [ ] **Step 1: 写失败测试 `tests/args.test.ts`**

```ts
import { test, expect } from "bun:test";
import { parseCliArgs, UsageError } from "../src/args";

test("requires at least one constraint", () => {
  expect(() => parseCliArgs(["a.jpg"])).toThrow(UsageError);
  expect(() => parseCliArgs(["a.jpg"])).toThrow(/at least one/);
});

test("requires at least one input", () => {
  expect(() => parseCliArgs(["--quality", "80"])).toThrow(/no input/);
});

test("rejects --output with multiple inputs", () => {
  expect(() =>
    parseCliArgs(["a.jpg", "b.jpg", "--output", "o.jpg", "--quality", "80"]),
  ).toThrow(/output/);
});

test("parses size, dimensions, format and defaults", () => {
  const o = parseCliArgs(["a.jpg", "--max-size", "500kb", "--max-side", "1600", "--format", "webp"]);
  expect(o.inputs).toEqual(["a.jpg"]);
  expect(o.maxSize).toBe(512000);
  expect(o.maxSide).toBe(1600);
  expect(o.format).toBe("webp");
  expect(o.suffix).toBe(".min");
  expect(o.background).toBe("#ffffff");
  expect(o.minQuality).toBe(1);
  expect(o.inPlace).toBe(false);
});

test("rejects out-of-range quality and bad format", () => {
  expect(() => parseCliArgs(["a.jpg", "--quality", "150"])).toThrow(/quality/);
  expect(() => parseCliArgs(["a.jpg", "--quality", "80", "--format", "bmp"])).toThrow(/format/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/args.test.ts`
Expected: FAIL（`Cannot find module '../src/args'`）。

- [ ] **Step 3: 实现 `src/args.ts`**

```ts
import { parseArgs } from "node:util";
import { parseSize } from "./size";
import { normalizeFormat, type TargetFormat } from "./format";

export class UsageError extends Error {}

export interface Options {
  inputs: string[];
  maxSize?: number;
  width?: number;
  height?: number;
  maxSide?: number;
  quality?: number;
  format?: TargetFormat;
  output?: string;
  outDir?: string;
  suffix: string;
  inPlace: boolean;
  recursive: boolean;
  background: string;
  minQuality: number;
  concurrency?: number;
  dryRun: boolean;
  help: boolean;
  version: boolean;
}

function parseIntStrict(raw: string, name: string): number {
  if (!/^\d+$/.test(raw.trim())) throw new UsageError(`--${name} must be a positive integer`);
  return parseInt(raw, 10);
}

function parseQuality(raw: string): number {
  const q = parseIntStrict(raw, "quality");
  if (q < 1 || q > 100) throw new UsageError("--quality must be 1-100");
  return q;
}

export function parseCliArgs(argv: string[]): Options {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "max-size": { type: "string" },
        width: { type: "string" },
        height: { type: "string" },
        "max-side": { type: "string" },
        quality: { type: "string" },
        format: { type: "string" },
        output: { type: "string" },
        "out-dir": { type: "string" },
        suffix: { type: "string" },
        "in-place": { type: "boolean", default: false },
        recursive: { type: "boolean", default: false },
        background: { type: "string" },
        "min-quality": { type: "string" },
        concurrency: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
        version: { type: "boolean", default: false },
      },
    });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }

  const v = parsed.values;
  const opts: Options = {
    inputs: parsed.positionals,
    suffix: v.suffix ?? ".min",
    inPlace: v["in-place"] ?? false,
    recursive: v.recursive ?? false,
    background: v.background ?? "#ffffff",
    minQuality: v["min-quality"] != null ? parseIntStrict(v["min-quality"], "min-quality") : 1,
    dryRun: v["dry-run"] ?? false,
    help: v.help ?? false,
    version: v.version ?? false,
  };

  if (v["max-size"] != null) {
    try {
      opts.maxSize = parseSize(v["max-size"]);
    } catch (err) {
      throw new UsageError((err as Error).message);
    }
  }
  if (v.width != null) opts.width = parseIntStrict(v.width, "width");
  if (v.height != null) opts.height = parseIntStrict(v.height, "height");
  if (v["max-side"] != null) opts.maxSide = parseIntStrict(v["max-side"], "max-side");
  if (v.quality != null) opts.quality = parseQuality(v.quality);
  if (v.format != null) {
    try {
      opts.format = normalizeFormat(v.format);
    } catch (err) {
      throw new UsageError((err as Error).message);
    }
  }
  if (v.output != null) opts.output = v.output;
  if (v["out-dir"] != null) opts.outDir = v["out-dir"];
  if (v.concurrency != null) opts.concurrency = parseIntStrict(v.concurrency, "concurrency");

  if (opts.help || opts.version) return opts;

  validate(opts);
  return opts;
}

function validate(opts: Options): void {
  if (opts.inputs.length === 0) throw new UsageError("no input files given");
  const hasConstraint =
    opts.maxSize != null ||
    opts.width != null ||
    opts.height != null ||
    opts.maxSide != null ||
    opts.quality != null;
  if (!hasConstraint) {
    throw new UsageError(
      "at least one of --max-size, --width, --height, --max-side, --quality is required",
    );
  }
  if (opts.output != null && opts.inputs.length > 1) {
    throw new UsageError("--output cannot be used with multiple inputs; use --out-dir");
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/args.test.ts`
Expected: PASS（5 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/args.ts tests/args.test.ts
git commit -m "feat: add CLI argument parsing and validation"
```

---

## Task 5: inputs.ts — 输入展开（文件/目录/glob）

**Files:**
- Create: `src/inputs.ts`
- Test: `tests/inputs.test.ts`

- [ ] **Step 1: 写失败测试 `tests/inputs.test.ts`**

```ts
import { test, expect } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandInputs } from "../src/inputs";

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ptiny-in-"));
  await writeFile(join(dir, "a.png"), "x");
  await writeFile(join(dir, "b.jpg"), "x");
  await writeFile(join(dir, "note.txt"), "x");
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, "sub", "c.webp"), "x");
  return dir;
}

test("expands a directory non-recursively and filters non-images", async () => {
  const dir = await fixtureDir();
  const files = await expandInputs([dir], false);
  expect(files.some((f) => f.endsWith("a.png"))).toBe(true);
  expect(files.some((f) => f.endsWith("b.jpg"))).toBe(true);
  expect(files.some((f) => f.endsWith("note.txt"))).toBe(false);
  expect(files.some((f) => f.endsWith("c.webp"))).toBe(false);
});

test("recurses into subdirectories when asked", async () => {
  const dir = await fixtureDir();
  const files = await expandInputs([dir], true);
  expect(files.some((f) => f.endsWith(join("sub", "c.webp")))).toBe(true);
});

test("dedups overlapping inputs", async () => {
  const dir = await fixtureDir();
  const a = join(dir, "a.png");
  const files = await expandInputs([a, a], false);
  expect(files.filter((f) => f.endsWith("a.png")).length).toBe(1);
});

test("throws on missing input", async () => {
  await expect(expandInputs(["/no/such/file.png"], false)).rejects.toThrow(/not found/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/inputs.test.ts`
Expected: FAIL（`Cannot find module '../src/inputs'`）。

- [ ] **Step 3: 实现 `src/inputs.ts`**

```ts
import { Glob } from "bun";
import { stat, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".tiff", ".tif"]);

function isGlob(s: string): boolean {
  return /[*?[\]{}]/.test(s);
}

async function listDir(dir: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive) files.push(...(await listDir(full, recursive)));
    } else {
      files.push(full);
    }
  }
  return files;
}

/** 把输入项（文件/目录/glob）展开为去重、排序后的图片路径列表。 */
export async function expandInputs(inputs: string[], recursive: boolean): Promise<string[]> {
  const out = new Set<string>();
  for (const item of inputs) {
    if (isGlob(item)) {
      const glob = new Glob(item);
      for await (const file of glob.scan({ onlyFiles: true })) out.add(file);
      continue;
    }
    let st;
    try {
      st = await stat(item);
    } catch {
      throw new Error(`input not found: ${item}`);
    }
    if (st.isDirectory()) {
      for (const f of await listDir(item, recursive)) {
        if (IMAGE_EXTS.has(extname(f).toLowerCase())) out.add(f);
      }
    } else {
      out.add(item);
    }
  }
  return [...out].sort();
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/inputs.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/inputs.ts tests/inputs.test.ts
git commit -m "feat: add input expansion for files, dirs and globs"
```

---

## Task 6: output.ts — 输出路径解析

**Files:**
- Create: `src/output.ts`
- Test: `tests/output.test.ts`

- [ ] **Step 1: 写失败测试 `tests/output.test.ts`**

```ts
import { test, expect } from "bun:test";
import { resolveOutputPath } from "../src/output";
import type { Options } from "../src/args";

function baseOpts(over: Partial<Options>): Options {
  return {
    inputs: [],
    suffix: ".min",
    inPlace: false,
    recursive: false,
    background: "#ffffff",
    minQuality: 1,
    dryRun: false,
    help: false,
    version: false,
    ...over,
  };
}

test("sibling path with suffix by default", () => {
  expect(resolveOutputPath("/x/a.jpg", "jpeg", baseOpts({}))).toBe("/x/a.min.jpg");
});

test("explicit --output wins", () => {
  expect(resolveOutputPath("/x/a.jpg", "jpeg", baseOpts({ output: "/out/o.jpg" }))).toBe("/out/o.jpg");
});

test("--out-dir keeps stem and applies format extension", () => {
  expect(resolveOutputPath("/x/a.png", "webp", baseOpts({ outDir: "/out" }))).toBe("/out/a.webp");
});

test("--in-place keeps path, swaps extension on format change", () => {
  expect(resolveOutputPath("/x/a.png", "png", baseOpts({ inPlace: true }))).toBe("/x/a.png");
  expect(resolveOutputPath("/x/a.png", "webp", baseOpts({ inPlace: true }))).toBe("/x/a.webp");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/output.test.ts`
Expected: FAIL（`Cannot find module '../src/output'`）。

- [ ] **Step 3: 实现 `src/output.ts`**

```ts
import { dirname, basename, extname, join } from "node:path";
import type { Options } from "./args";
import type { TargetFormat } from "./format";

const FORMAT_EXT: Record<TargetFormat, string> = {
  jpeg: ".jpg",
  png: ".png",
  webp: ".webp",
  avif: ".avif",
};

function changeExt(p: string, ext: string): string {
  return join(dirname(p), basename(p, extname(p)) + ext);
}

/** 依据选项与目标格式解析单个输入文件的输出路径。 */
export function resolveOutputPath(input: string, format: TargetFormat, opts: Options): string {
  const ext = FORMAT_EXT[format];
  if (opts.output) return opts.output;
  if (opts.inPlace) return changeExt(input, ext);
  if (opts.outDir) return join(opts.outDir, basename(input, extname(input)) + ext);
  const stem = basename(input, extname(input));
  return join(dirname(input), `${stem}${opts.suffix}${ext}`);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/output.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/output.ts tests/output.test.ts
git commit -m "feat: add output path resolution"
```

---

## Task 7: run.ts — 单文件流水线与并发

**Files:**
- Create: `src/run.ts`
- Test: `tests/run.test.ts`

- [ ] **Step 1: 写失败测试 `tests/run.test.ts`**

```ts
import { test, expect } from "bun:test";
import sharp from "sharp";
import { mkdtemp, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processFile, processAll } from "../src/run";
import type { Options } from "../src/args";

function noiseRaw(w: number, h: number, c: number): Buffer {
  const data = Buffer.alloc(w * h * c);
  let x = 987654321;
  for (let i = 0; i < data.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    data[i] = x % 256;
  }
  return data;
}

async function writeNoiseJpeg(path: string, w: number, h: number): Promise<void> {
  const buf = await sharp(noiseRaw(w, h, 3), { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
  await writeFile(path, buf);
}

function baseOpts(over: Partial<Options>): Options {
  return {
    inputs: [],
    suffix: ".min",
    inPlace: false,
    recursive: false,
    background: "#ffffff",
    minQuality: 1,
    dryRun: false,
    help: false,
    version: false,
    ...over,
  };
}

test("processFile writes a compressed file and reports stats", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptiny-run-"));
  const input = join(dir, "in.jpg");
  await writeNoiseJpeg(input, 700, 700);
  const res = await processFile(input, baseOpts({ maxSize: 25 * 1024, outDir: dir }));
  expect(res.ok).toBe(true);
  expect(res.output).toBe(join(dir, "in.jpg"));
  expect(res.outputBytes!).toBeLessThanOrEqual(25 * 1024);
  expect(res.savedBytes!).toBeGreaterThan(0);
  expect((await stat(res.output!)).size).toBe(res.outputBytes);
});

test("processFile dry-run does not write", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptiny-run-"));
  const input = join(dir, "in.jpg");
  await writeNoiseJpeg(input, 400, 400);
  const out = join(dir, "in.min.jpg");
  const res = await processFile(input, baseOpts({ quality: 50, dryRun: true }));
  expect(res.ok).toBe(true);
  await expect(stat(out)).rejects.toThrow();
});

test("processFile reports error for unreadable input", async () => {
  const res = await processFile("/no/such.jpg", baseOpts({ quality: 50 }));
  expect(res.ok).toBe(false);
  expect(res.error).toBeTruthy();
});

test("processAll handles multiple files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptiny-run-"));
  const a = join(dir, "a.jpg");
  const b = join(dir, "b.jpg");
  await writeNoiseJpeg(a, 300, 300);
  await writeNoiseJpeg(b, 300, 300);
  const results = await processAll([a, b], baseOpts({ quality: 60, outDir: dir }));
  expect(results.length).toBe(2);
  expect(results.every((r) => r.ok)).toBe(true);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/run.test.ts`
Expected: FAIL（`Cannot find module '../src/run'`）。

- [ ] **Step 3: 实现 `src/run.ts`**

```ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { cpus } from "node:os";
import { compressImage } from "./compress";
import { resolveOutputPath } from "./output";
import type { Options } from "./args";

export interface FileResult {
  input: string;
  output?: string;
  ok: boolean;
  error?: string;
  originalFormat?: string;
  format?: string;
  originalWidth?: number;
  originalHeight?: number;
  width?: number;
  height?: number;
  originalBytes?: number;
  outputBytes?: number;
  savedBytes?: number;
  savedPercent?: number;
  ratio?: number;
  quality?: number | null;
  targetBytes?: number | null;
  reachedTarget?: boolean;
  iterations?: number;
  warnings?: string[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** 读取→压缩→写出单个文件，捕获错误为结果记录（不抛出）。 */
export async function processFile(input: string, opts: Options): Promise<FileResult> {
  try {
    const buf = await readFile(input);
    const result = await compressImage(buf, {
      maxSize: opts.maxSize,
      width: opts.width,
      height: opts.height,
      maxSide: opts.maxSide,
      quality: opts.quality,
      format: opts.format,
      background: opts.background,
      minQuality: opts.minQuality,
    });
    const output = resolveOutputPath(input, result.format, opts);
    if (!opts.dryRun) {
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, result.buffer);
    }
    const originalBytes = buf.length;
    const outputBytes = result.buffer.length;
    return {
      input,
      output,
      ok: true,
      originalFormat: result.originalFormat,
      format: result.format,
      originalWidth: result.originalWidth,
      originalHeight: result.originalHeight,
      width: result.width,
      height: result.height,
      originalBytes,
      outputBytes,
      savedBytes: originalBytes - outputBytes,
      savedPercent: round1((1 - outputBytes / originalBytes) * 100),
      ratio: round4(outputBytes / originalBytes),
      quality: result.quality,
      targetBytes: result.targetBytes,
      reachedTarget: result.reachedTarget,
      iterations: result.iterations,
      warnings: result.warnings,
    };
  } catch (err) {
    return { input, ok: false, error: (err as Error).message };
  }
}

/** 以受限并发处理一组文件，结果顺序与输入一致。 */
export async function processAll(files: string[], opts: Options): Promise<FileResult[]> {
  const concurrency = Math.max(1, opts.concurrency ?? cpus().length);
  const results: FileResult[] = new Array(files.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= files.length) break;
      results[i] = await processFile(files[i]!, opts);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test tests/run.test.ts`
Expected: PASS（4 tests）。

- [ ] **Step 5: 提交**

```bash
git add src/run.ts tests/run.test.ts
git commit -m "feat: add per-file pipeline and bounded concurrency"
```

---

## Task 8: cli.ts + index.ts — 编排、JSON 输出、库 API

**Files:**
- Create: `src/cli.ts`
- Create: `src/index.ts`
- Test: `tests/cli.test.ts`

- [ ] **Step 1: 写失败测试 `tests/cli.test.ts`**

```ts
import { test, expect } from "bun:test";
import sharp from "sharp";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function noiseRaw(w: number, h: number, c: number): Buffer {
  const data = Buffer.alloc(w * h * c);
  let x = 2024;
  for (let i = 0; i < data.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    data[i] = x % 256;
  }
  return data;
}

async function runCli(args: string[]): Promise<{ code: number; json: any; stdout: string }> {
  const proc = Bun.spawn(["bun", "bin/ptiny", ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, json: JSON.parse(stdout), stdout };
}

test("compresses a real file to target size, stdout is pure JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptiny-cli-"));
  const input = join(dir, "in.jpg");
  const buf = await sharp(noiseRaw(700, 700, 3), { raw: { width: 700, height: 700, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
  await writeFile(input, buf);

  const { code, json } = await runCli([input, "--max-size", "20kb", "--out-dir", dir]);
  expect(code).toBe(0);
  expect(json.ok).toBe(true);
  expect(json.summary.count).toBe(1);
  expect(json.results[0].outputBytes).toBeLessThanOrEqual(20 * 1024);
  expect(json.results[0].reachedTarget).toBe(true);
});

test("usage error returns code 2 and JSON error", async () => {
  const { code, json } = await runCli(["only-input-no-constraint.jpg"]);
  expect(code).toBe(2);
  expect(json.ok).toBe(false);
  expect(json.error).toMatch(/at least one/);
});

test("--version prints JSON and exits 0", async () => {
  const { code, json } = await runCli(["--version"]);
  expect(code).toBe(0);
  expect(json.version).toBeTruthy();
});
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test tests/cli.test.ts`
Expected: FAIL（`bin/ptiny` 导入 `src/cli` 不存在 → `parse JSON` 抛错或非零码）。

- [ ] **Step 3: 实现 `src/cli.ts`**

```ts
import { parseCliArgs, UsageError } from "./args";
import { expandInputs } from "./inputs";
import { processAll, type FileResult } from "./run";

const VERSION = "0.1.0";

const HELP = `ptiny - compress images to a target file size and/or pixel size

Usage: ptiny [options] <input...>

Targets (at least one required):
  --max-size <500kb|1.5mb|N>   target max file size
  --width <px>                 target width
  --height <px>                target height
  --max-side <px>              cap the longest side
  --quality <1-100>            fixed quality (skip size search)
Format:
  --format <jpeg|png|webp|avif>  convert format (default: keep original)
Output:
  --output <file>              output path (single input only)
  --out-dir <dir>              output directory
  --suffix <.min>              sibling suffix (default .min)
  --in-place                   overwrite originals
  --recursive                  recurse into directories
Behavior:
  --background <white>         flatten color for alpha->jpeg
  --min-quality <n>            quality search floor (default 1)
  --concurrency <n>            parallel workers (default cpu count)
  --dry-run                    compute without writing
  --help, --version`;

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function emit(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

/** CLI 主入口，返回退出码。stdout 始终为 JSON，日志走 stderr。 */
export async function main(argv: string[]): Promise<number> {
  let opts;
  try {
    opts = parseCliArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      emit({ ok: false, error: err.message });
      return 2;
    }
    throw err;
  }

  if (opts.help) {
    emit({ ok: true, help: HELP });
    return 0;
  }
  if (opts.version) {
    emit({ ok: true, version: VERSION });
    return 0;
  }

  let files: string[];
  try {
    files = await expandInputs(opts.inputs, opts.recursive);
  } catch (err) {
    emit({ ok: false, error: (err as Error).message });
    return 2;
  }
  if (files.length === 0) {
    emit({ ok: false, error: "no image files matched the given inputs" });
    return 2;
  }

  const results = await processAll(files, opts);
  const okResults = results.filter((r) => r.ok);
  const errorResults = results.filter((r) => !r.ok);

  const originalBytes = sum(okResults.map((r) => r.originalBytes ?? 0));
  const outputBytes = sum(okResults.map((r) => r.outputBytes ?? 0));
  const savedBytes = originalBytes - outputBytes;

  const payload = {
    ok: errorResults.length === 0,
    summary: {
      count: results.length,
      ok: okResults.length,
      failed: errorResults.length,
      originalBytes,
      outputBytes,
      savedBytes,
      savedPercent: originalBytes > 0 ? round1((savedBytes / originalBytes) * 100) : 0,
    },
    results: okResults,
    errors: errorResults.map((r: FileResult) => ({
      input: r.input,
      ok: false,
      error: r.error,
    })),
  };
  emit(payload);
  return errorResults.length === 0 ? 0 : 1;
}
```

- [ ] **Step 4: 实现 `src/index.ts`**

```ts
export { compressImage, assertStatic } from "./compress";
export type { CompressOptions, CompressResult } from "./compress";
export { parseSize, formatBytes } from "./size";
export { parseCliArgs, UsageError } from "./args";
export type { Options } from "./args";
export { main } from "./cli";
```

- [ ] **Step 5: 运行确认通过**

Run: `bun test tests/cli.test.ts`
Expected: PASS（3 tests）。

- [ ] **Step 6: 提交**

```bash
git add src/cli.ts src/index.ts tests/cli.test.ts
git commit -m "feat: add CLI orchestration, JSON output and library API"
```

---

## Task 9: README + 全量验证

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README.md**

````markdown
# picture-tiny-cli (`ptiny`)

在 agent 中可靠调用的图片压缩 CLI：压到目标文件体积和/或像素尺寸，最小程度影响画质，stdout 始终输出纯 JSON。

## 安装

```bash
bun install
```

## 用法

```bash
# 压到 500KB 以内，保留原格式
bun bin/ptiny photo.jpg --max-size 500kb

# 限制最长边 1600px 并转 webp，输出到目录
bun bin/ptiny ./imgs/*.png --max-side 1600 --format webp --out-dir ./out

# 同时限定体积与尺寸
bun bin/ptiny photo.jpg --max-size 300kb --max-side 1920
```

## 选项

见 `bun bin/ptiny --help`。

## 输出（JSON）

```json
{
  "ok": true,
  "summary": { "count": 1, "ok": 1, "failed": 0, "savedPercent": 64.0 },
  "results": [
    { "input": "photo.jpg", "output": "photo.min.jpg", "ok": true,
      "outputBytes": 180000, "quality": 78, "reachedTarget": true, "warnings": [] }
  ],
  "errors": []
}
```

退出码：全成功 `0`，部分失败 `1`，用法错误 `2`。

## 库用法

```ts
import { compressImage } from "picture-tiny-cli";
const out = await compressImage(buffer, { maxSize: 200 * 1024, maxSide: 1600 });
```
````

- [ ] **Step 2: 运行全量测试套件**

Run: `bun test`
Expected: 全部 PASS（smoke + size + format + compress + args + inputs + output + run + cli）。

- [ ] **Step 3: 真实样例端到端验证**

Run:
```bash
bun bin/ptiny --version
mkdir -p /tmp/ptiny-demo
bun -e 'import sharp from "sharp"; const w=900,h=900,c=3; const d=Buffer.alloc(w*h*c); let x=7; for(let i=0;i<d.length;i++){x=(x*1103515245+12345)&0x7fffffff; d[i]=x%256;} await sharp(d,{raw:{width:w,height:h,channels:c}}).jpeg({quality:100}).toFile("/tmp/ptiny-demo/big.jpg");'
bun bin/ptiny /tmp/ptiny-demo/big.jpg --max-size 50kb --out-dir /tmp/ptiny-demo
```
Expected: 输出 JSON，`results[0].outputBytes <= 51200`，`reachedTarget: true`，`/tmp/ptiny-demo/big.jpg`（out-dir 同名）被写出。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: add README and finalize picture-tiny-cli"
```

---

## Self-Review

**Spec coverage:**
- 目标体积（二分搜索）→ Task 3。✅
- 目标像素尺寸（width/height/max-side、不放大）→ Task 3。✅
- 两者组合 → Task 3 compressImage 先 resize 后搜索。✅
- 仅 JSON 输出 + 退出码 → Task 8。✅
- 格式默认保留、可 `--format` 转换 → Task 2/3。✅
- 单文件/多文件/目录/glob/recursive → Task 5。✅
- 输出路径（output/out-dir/in-place/suffix，不覆盖原图）→ Task 6。✅
- 边界：不可达 best-effort、PNG 量化+建议、alpha→jpeg 压平、动图拒绝、不放大 → Task 3。✅
- 库 API → Task 8 index.ts。✅
- sharp×bun 风险 → Task 0 smoke。✅
- 测试策略（程序化测试图、CLI 集成）→ 各 Task + Task 8。✅

**Placeholder scan:** 无 TBD/TODO；每个代码步骤含完整代码。✅

**Type consistency:** `CompressOptions/CompressResult`（compress.ts）、`Options/UsageError`（args.ts）、`TargetFormat`（format.ts）、`FileResult`（run.ts）跨任务签名一致；`applyEncoder(pipeline, format, quality:number|null)`、`resolveOutputPath(input, format, opts)`、`processFile/processAll`、`main(argv)` 调用处一致。✅
