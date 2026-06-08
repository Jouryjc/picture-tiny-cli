import { test, expect } from "bun:test";
import sharp from "sharp";

test("sharp encodes jpeg/png/webp under bun", async () => {
  const base = sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 10, g: 20, b: 30 } },
  });
  const jpeg = await base.clone().jpeg({ quality: 80 }).toBuffer();
  const png = await base.clone().png().toBuffer();
  const webp = await base.clone().webp({ quality: 80 }).toBuffer();
  expect(jpeg.length).toBeGreaterThan(0);
  expect(png.length).toBeGreaterThan(0);
  expect(webp.length).toBeGreaterThan(0);
  expect((await sharp(jpeg).metadata()).format).toBe("jpeg");
});
