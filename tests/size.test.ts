import { test, expect } from "bun:test";
import { parseSize, formatBytes } from "../src/size";

test("parseSize handles units (1KB=1024)", () => {
  expect(parseSize("500kb")).toBe(512000);
  expect(parseSize("1.5mb")).toBe(Math.round(1.5 * 1024 * 1024));
  expect(parseSize("200000")).toBe(200000);
  expect(parseSize("2 MB")).toBe(2 * 1024 * 1024);
  expect(parseSize("1gb")).toBe(1024 ** 3);
});

test("parseSize rejects invalid input", () => {
  expect(() => parseSize("abc")).toThrow();
  expect(() => parseSize("10xb")).toThrow();
  expect(() => parseSize("")).toThrow();
});

test("formatBytes is human readable", () => {
  expect(formatBytes(512)).toBe("512B");
  expect(formatBytes(1536)).toBe("1.5KB");
  expect(formatBytes(1024 * 1024)).toBe("1.0MB");
});
