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
  const n = parseInt(raw, 10);
  if (n < 1) throw new UsageError(`--${name} must be a positive integer`);
  return n;
}

function parseQuality(raw: string, name: string): number {
  const q = parseIntStrict(raw, name);
  if (q > 100) throw new UsageError(`--${name} must be 1-100`);
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
    minQuality: v["min-quality"] != null ? parseQuality(v["min-quality"], "min-quality") : 1,
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
  if (v.quality != null) opts.quality = parseQuality(v.quality, "quality");
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
  if (opts.inPlace && (opts.output != null || opts.outDir != null)) {
    throw new UsageError("--in-place cannot be combined with --output or --out-dir");
  }
}
