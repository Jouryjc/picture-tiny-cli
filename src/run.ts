import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

/**
 * 读取→压缩→写出单个文件，捕获错误为结果记录（不抛出）。
 * `claimed` 跨文件共享，用于检测一次调用内多个输入写到同一输出路径的冲突。
 */
export async function processFile(
  input: string,
  opts: Options,
  claimed: Set<string> = new Set(),
): Promise<FileResult> {
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
    const resolvedOut = resolve(output);
    // 绝不静默覆盖原图：输出落回输入自身且未显式 --in-place 时拒绝。
    if (!opts.inPlace && resolvedOut === resolve(input)) {
      return {
        input,
        ok: false,
        error: `refusing to overwrite the original without --in-place: ${input}`,
      };
    }
    // 同一次调用内多个输入写到同一输出路径会相互覆盖——报错而非静默丢失。
    if (claimed.has(resolvedOut)) {
      return {
        input,
        ok: false,
        error: `output path collides with another input: ${output}`,
      };
    }
    claimed.add(resolvedOut);
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
  const claimed = new Set<string>();
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= files.length) break;
      results[i] = await processFile(files[i]!, opts, claimed);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
