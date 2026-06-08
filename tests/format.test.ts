import { test, expect } from "bun:test";
import sharp from "sharp";
import { normalizeFormat, applyEncoder, DEFAULT_QUALITY, LOSSY_FORMATS } from "../src/format";

test("normalizeFormat maps aliases and rejects unknown", () => {
  expect(normalizeFormat("jpg")).toBe("jpeg");
  expect(normalizeFormat("JPEG")).toBe("jpeg");
  expect(normalizeFormat("png")).toBe("png");
  expect(normalizeFormat("webp")).toBe("webp");
  expect(normalizeFormat("avif")).toBe("avif");
  expect(() => normalizeFormat("bmp")).toThrow();
});

test("LOSSY_FORMATS contains lossy targets", () => {
  expect(LOSSY_FORMATS.has("jpeg")).toBe(true);
  expect(LOSSY_FORMATS.has("png")).toBe(false);
});

test("applyEncoder produces the requested format", async () => {
  const base = () =>
    sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 1, g: 2, b: 3 } } });
  const jpeg = await applyEncoder(base(), "jpeg", 70).toBuffer();
  const webp = await applyEncoder(base(), "webp", 70).toBuffer();
  const pngLossless = await applyEncoder(base(), "png", null).toBuffer();
  const pngQuant = await applyEncoder(base(), "png", 50).toBuffer();
  expect((await sharp(jpeg).metadata()).format).toBe("jpeg");
  expect((await sharp(webp).metadata()).format).toBe("webp");
  expect((await sharp(pngLossless).metadata()).format).toBe("png");
  expect((await sharp(pngQuant).metadata()).format).toBe("png");
  expect(DEFAULT_QUALITY).toBeGreaterThan(0);
});
