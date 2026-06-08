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
