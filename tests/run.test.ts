import { test, expect } from "bun:test";
import sharp from "sharp";
import { mkdtemp, writeFile, stat, mkdir } from "node:fs/promises";
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
  const outDir = join(dir, "out");
  await writeNoiseJpeg(input, 700, 700);
  const res = await processFile(input, baseOpts({ maxSize: 25 * 1024, outDir }));
  expect(res.ok).toBe(true);
  expect(res.output).toBe(join(outDir, "in.jpg"));
  expect(res.outputBytes!).toBeLessThanOrEqual(25 * 1024);
  expect(res.savedBytes!).toBeGreaterThan(0);
  expect((await stat(res.output!)).size).toBe(res.outputBytes);
});

test("processFile refuses to overwrite the original without --in-place", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptiny-run-"));
  const input = join(dir, "in.jpg");
  await writeNoiseJpeg(input, 300, 300);
  const sizeBefore = (await stat(input)).size;
  // suffix "" makes the sibling output path equal the input path
  const res = await processFile(input, baseOpts({ quality: 50, suffix: "" }));
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/overwrite the original/i);
  expect((await stat(input)).size).toBe(sizeBefore); // original untouched
});

test("processAll flags output-path collisions instead of silently overwriting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptiny-run-"));
  const a = join(dir, "a");
  const b = join(dir, "b");
  await mkdir(a, { recursive: true });
  await mkdir(b, { recursive: true });
  const ai = join(a, "img.jpg");
  const bi = join(b, "img.jpg");
  await writeNoiseJpeg(ai, 200, 200);
  await writeNoiseJpeg(bi, 200, 200);
  const outDir = join(dir, "out");
  const results = await processAll([ai, bi], baseOpts({ quality: 60, outDir }));
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  expect(ok.length).toBe(1);
  expect(failed.length).toBe(1);
  expect(failed[0]!.error).toMatch(/collides/i);
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
  const results = await processAll([a, b], baseOpts({ quality: 60, outDir: join(dir, "out") }));
  expect(results.length).toBe(2);
  expect(results.every((r) => r.ok)).toBe(true);
});
