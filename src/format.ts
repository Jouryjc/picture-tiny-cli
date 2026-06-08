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
