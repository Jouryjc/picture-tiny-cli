import { test, expect } from "bun:test";
import { parseCliArgs, UsageError } from "../src/args";

test("requires at least one constraint", () => {
  expect(() => parseCliArgs(["a.jpg"])).toThrow(UsageError);
  expect(() => parseCliArgs(["a.jpg"])).toThrow(/at least one/);
});

test("requires at least one input", () => {
  expect(() => parseCliArgs(["--quality", "80"])).toThrow(/no input/);
});

test("rejects --output with multiple inputs", () => {
  expect(() =>
    parseCliArgs(["a.jpg", "b.jpg", "--output", "o.jpg", "--quality", "80"]),
  ).toThrow(/output/);
});

test("parses size, dimensions, format and defaults", () => {
  const o = parseCliArgs(["a.jpg", "--max-size", "500kb", "--max-side", "1600", "--format", "webp"]);
  expect(o.inputs).toEqual(["a.jpg"]);
  expect(o.maxSize).toBe(512000);
  expect(o.maxSide).toBe(1600);
  expect(o.format).toBe("webp");
  expect(o.suffix).toBe(".min");
  expect(o.background).toBe("#ffffff");
  expect(o.minQuality).toBe(1);
  expect(o.inPlace).toBe(false);
});

test("rejects out-of-range quality and bad format", () => {
  expect(() => parseCliArgs(["a.jpg", "--quality", "150"])).toThrow(/quality/);
  expect(() => parseCliArgs(["a.jpg", "--quality", "80", "--format", "bmp"])).toThrow(/format/);
});

test("rejects zero for integer dimension/concurrency args", () => {
  expect(() => parseCliArgs(["a.jpg", "--width", "0"])).toThrow(/width/);
  expect(() => parseCliArgs(["a.jpg", "--max-side", "0"])).toThrow(/max-side/);
  expect(() => parseCliArgs(["a.jpg", "--quality", "80", "--concurrency", "0"])).toThrow(
    /concurrency/,
  );
});

test("bounds min-quality to 1-100", () => {
  expect(() =>
    parseCliArgs(["a.jpg", "--max-size", "100kb", "--min-quality", "200"]),
  ).toThrow(/min-quality/);
  const o = parseCliArgs(["a.jpg", "--max-size", "100kb", "--min-quality", "10"]);
  expect(o.minQuality).toBe(10);
});

test("rejects --in-place combined with --output or --out-dir", () => {
  expect(() =>
    parseCliArgs(["a.jpg", "--quality", "80", "--in-place", "--output", "o.jpg"]),
  ).toThrow(/in-place/);
  expect(() =>
    parseCliArgs(["a.jpg", "--quality", "80", "--in-place", "--out-dir", "out"]),
  ).toThrow(/in-place/);
});

test("rejects --in-place combined with --format", () => {
  expect(() =>
    parseCliArgs(["a.png", "--quality", "80", "--in-place", "--format", "webp"]),
  ).toThrow(/in-place/);
});
