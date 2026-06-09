---
name: compressing-images
description: Use when the user wants to shrink or compress an image file — reduce its file size to a target (e.g. under 500KB), resize to specific pixel dimensions, or convert format (PNG/JPEG/WebP/AVIF) with minimal quality loss. Triggers include 压缩图片, 图片瘦身, 图片变小, 压到多少KB/MB, reduce/shrink image size, compress photo, make image smaller, hit a target file size.
---

# Compressing Images (ptiny)

## Overview

`ptiny` (from the **picture-tiny-cli** project) is a bun + sharp CLI that compresses images while minimizing quality loss. To hit a target file size it **binary-searches the encoder quality** and keeps the highest quality whose output is ≤ the target — strictly better than guessing a quality by hand (don't reach for `sips`/`convert`/manual quality trials). It can also resize (never upscales) and convert formats. **stdout is always pure JSON**, so parse the result directly.

## Setup (one-time)

This skill drives the `ptiny` CLI. Install it once:

1. In the picture-tiny-cli repo, install deps: `bun install`.
2. Expose the command — either:
   - **global**: run `bun link` inside the repo (registers `ptiny`), or symlink `bin/ptiny` onto your `PATH`; then call `ptiny …`
   - **direct**: call `bun /path/to/picture-tiny-cli/bin/ptiny …`

Verify: `ptiny --version` → `{"ok":true,"version":…}`. (The command needs the repo's local `node_modules/sharp`; keep the repo installed.)

## Usage

```
ptiny [options] <input...>          # input: file(s) / directory / glob
```

At least one target is REQUIRED: `--max-size`, `--width`, `--height`, `--max-side`, or `--quality`.

| Flag | Purpose |
|---|---|
| `--max-size <500kb\|1.5mb\|N>` | target max file size (binary-search quality). 1KB=1024 |
| `--max-side <px>` | cap the longest side (resize, never upscale) |
| `--width <px>` / `--height <px>` | target width/height |
| `--quality <1-100>` | fixed quality, skips the size search |
| `--format jpeg\|png\|webp\|avif` | convert (default: keep original format) |
| `--out-dir <dir>` / `--output <file>` | where to write (batch / single) |
| `--in-place` | overwrite originals (otherwise writes `<name>.min.<ext>`) |
| `--dry-run` | compute + report, write nothing |
| `--concurrency <n>` / `--recursive` / `--suffix <s>` | batch knobs |

## Recipes

```bash
ptiny photo.jpg --max-size 200kb                        # ≤200KB, keep format, → photo.min.jpg
ptiny photo.png --max-size 300kb --max-side 1920        # size + dimension combined
ptiny photo.png --format webp --quality 90              # convert for best quality-at-size
ptiny ./imgs/*.png --max-size 500kb --out-dir ./out     # batch
ptiny photo.jpg --max-side 1600 --dry-run               # inspect without writing
```

## Reading the JSON

- Top level: `ok` (all succeeded), `summary{count,ok,failed,originalBytes,outputBytes,savedPercent}`, `results[]`, `errors[]`.
- Each result: `output`, `outputBytes`, `savedPercent`, `quality`, `width/height`, `reachedTarget`, `warnings[]`.
- `reachedTarget:false` + a warning ⇒ even the floor quality couldn't meet `--max-size` (best effort emitted). For stubborn PNGs the warning suggests `--format webp`.
- Exit codes: `0` all ok · `1` some files failed (see `errors[]`) · `2` usage error.

## Key behaviors / mistakes

- **Originals are never overwritten** unless `--in-place`; default output is a sibling `<name>.min.<ext>`. Pointing `--out-dir` at the source dir (output == input) is refused — use `--in-place` to overwrite.
- For "smallest with least quality loss", prefer `--max-size` (it finds the best quality under the cap). If a PNG won't shrink enough, convert: `--format webp`.
- Animated GIF/WebP are not supported (reported in `errors[]`).
- Don't combine `--in-place` with `--format` or `--out-dir`/`--output` (rejected as usage errors).
