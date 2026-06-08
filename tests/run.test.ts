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
