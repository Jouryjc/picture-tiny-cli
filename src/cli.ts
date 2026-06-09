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
