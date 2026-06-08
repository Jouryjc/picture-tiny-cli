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
