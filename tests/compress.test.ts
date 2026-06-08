import { test, expect } from "bun:test";
import sharp from "sharp";
import { compressImage, assertStatic } from "../src/compress";

/** 确定性伪噪声原始像素（避免纯色被压到极小，便于体积测试）。 */
function noiseRaw(w: number, h: number, channels: number): Buffer {
  const data = Buffer.alloc(w * h * channels);
  let x = 123456789;
  for (let i = 0; i < data.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    data[i] = x % 256;
  }
  return data;
}

async function noiseJpeg(w: number, h: number): Promise<Buffer> {
  return sharp(noiseRaw(w, h, 3), { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
}

async function noisePngAlpha(w: number, h: number): Promise<Buffer> {
  return sharp(noiseRaw(w, h, 4), { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toBuffer();
}

test("assertStatic rejects animated metadata", () => {
  expect(() => assertStatic(3)).toThrow(/animated/);
  expect(() => assertStatic(1)).not.toThrow();
  expect(() => assertStatic(undefined)).not.toThrow();
});

test("hits target file size with reachedTarget true", async () => {
  const big = await noiseJpeg(800, 800);
  const target = 30 * 1024;
  const res = await compressImage(big, { maxSize: target, minQuality: 1 });
  expect(res.buffer.length).toBeLessThanOrEqual(target);
  expect(res.reachedTarget).toBe(true);
  expect(res.quality).toBeGreaterThanOrEqual(1);
  expect(res.iterations).toBeGreaterThan(0);
});

test("resizes to max-side preserving aspect ratio", async () => {
  const img = await noiseJpeg(1000, 500);
  const res = await compressImage(img, { maxSide: 400, quality: 80 });
  expect(Math.max(res.width, res.height)).toBeLessThanOrEqual(400);
  expect(res.width).toBe(400);
  expect(res.height).toBe(200);
});

test("never upscales and warns", async () => {
  const img = await noiseJpeg(200, 200);
  const res = await compressImage(img, { width: 1000, quality: 80 });
  expect(res.width).toBe(200);
  expect(res.warnings.some((w) => /upscal/i.test(w))).toBe(true);
});

test("converts png to webp", async () => {
  const png = await noisePngAlpha(300, 300);
  const res = await compressImage(png, { format: "webp", quality: 80 });
  expect(res.format).toBe("webp");
  expect((await sharp(res.buffer).metadata()).format).toBe("webp");
});

test("flattens alpha when converting to jpeg", async () => {
  const png = await noisePngAlpha(120, 120);
  const res = await compressImage(png, { format: "jpeg", quality: 80, background: "#ffffff" });
  const meta = await sharp(res.buffer).metadata();
  expect(meta.format).toBe("jpeg");
  expect(meta.hasAlpha).toBe(false);
});

test("best effort when target is unreachable", async () => {
  const img = await noiseJpeg(1200, 1200);
  const res = await compressImage(img, { maxSize: 100, minQuality: 1 });
  expect(res.reachedTarget).toBe(false);
  expect(res.warnings.length).toBeGreaterThan(0);
});
