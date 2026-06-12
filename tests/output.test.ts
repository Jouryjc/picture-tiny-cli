import { test, expect } from "bun:test";
import { join } from "node:path";
import { resolveOutputPath } from "../src/output";
import type { Options } from "../src/args";

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

test("sibling path with suffix by default", () => {
  expect(resolveOutputPath("/x/a.jpg", "jpeg", baseOpts({}))).toBe(join("/x", "a.min.jpg"));
});

test("explicit --output wins", () => {
  expect(resolveOutputPath("/x/a.jpg", "jpeg", baseOpts({ output: "/out/o.jpg" }))).toBe("/out/o.jpg");
});

test("--out-dir keeps stem and applies format extension", () => {
  expect(resolveOutputPath("/x/a.png", "webp", baseOpts({ outDir: "/out" }))).toBe(join("/out", "a.webp"));
});

test("--in-place keeps path, swaps extension on format change", () => {
  expect(resolveOutputPath("/x/a.png", "png", baseOpts({ inPlace: true }))).toBe(join("/x", "a.png"));
  expect(resolveOutputPath("/x/a.png", "webp", baseOpts({ inPlace: true }))).toBe(join("/x", "a.webp"));
});
