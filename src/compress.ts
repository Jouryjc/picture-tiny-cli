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
    if (targetBytes != null) {
      reachedTarget = resultBuffer.length <= targetBytes;
      if (!reachedTarget) {
        warnings.push(
          `fixed --quality ${chosenQuality} produced ${resultBuffer.length} bytes, ` +
            `exceeding target ${targetBytes}; omit --quality to let size search pick a smaller quality`,
        );
      }
    }
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
