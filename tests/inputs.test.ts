import { test, expect } from "bun:test";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import { expandInputs } from "../src/inputs";
import { chdir, cwd as getCwd } from "node:process";

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ptiny-in-"));
  await writeFile(join(dir, "a.png"), "x");
  await writeFile(join(dir, "b.jpg"), "x");
  await writeFile(join(dir, "note.txt"), "x");
  await mkdir(join(dir, "sub"));
  await writeFile(join(dir, "sub", "c.webp"), "x");
  return dir;
}

test("expands a directory non-recursively and filters non-images", async () => {
  const dir = await fixtureDir();
  const files = await expandInputs([dir], false);
  expect(files.some((f) => f.endsWith("a.png"))).toBe(true);
  expect(files.some((f) => f.endsWith("b.jpg"))).toBe(true);
  expect(files.some((f) => f.endsWith("note.txt"))).toBe(false);
  expect(files.some((f) => f.endsWith("c.webp"))).toBe(false);
});

test("recurses into subdirectories when asked", async () => {
  const dir = await fixtureDir();
  const files = await expandInputs([dir], true);
  expect(files.some((f) => f.endsWith(join("sub", "c.webp")))).toBe(true);
});

test("dedups overlapping inputs", async () => {
  const dir = await fixtureDir();
  const a = join(dir, "a.png");
  const files = await expandInputs([a, a], false);
  expect(files.filter((f) => f.endsWith("a.png")).length).toBe(1);
});

test("throws on missing input", async () => {
  await expect(expandInputs(["/no/such/file.png"], false)).rejects.toThrow(/not found/);
});

test("glob pattern returns absolute paths and filters non-images", async () => {
  const dir = await fixtureDir();
  const orig = getCwd();
  try {
    chdir(dir);
    // '*' matches everything in dir — should only return image files, not note.txt
    const files = await expandInputs(["*"], false);
    expect(files.every((f) => isAbsolute(f))).toBe(true);
    expect(files.some((f) => f.endsWith("a.png"))).toBe(true);
    expect(files.some((f) => f.endsWith("b.jpg"))).toBe(true);
    expect(files.some((f) => f.endsWith("note.txt"))).toBe(false);
    // 'sub' dir itself is excluded (onlyFiles), and sub/c.webp is not matched by flat '*'
    expect(files.some((f) => f.endsWith("c.webp"))).toBe(false);
  } finally {
    chdir(orig);
  }
});

test("glob pattern with absolute prefix returns absolute paths", async () => {
  const dir = await fixtureDir();
  // Absolute glob pattern
  const pattern = join(dir, "*.png");
  const files = await expandInputs([pattern], false);
  expect(files.length).toBe(1);
  expect(files[0]).toBe(join(dir, "a.png"));
  expect(isAbsolute(files[0]!)).toBe(true);
});

test("glob pattern filters out non-image extensions", async () => {
  const dir = await fixtureDir();
  // Broad glob matching everything by extension-less glob in sub
  const pattern = join(dir, "*");
  const files = await expandInputs([pattern], false);
  expect(files.some((f) => f.endsWith("note.txt"))).toBe(false);
  expect(files.some((f) => f.endsWith("a.png"))).toBe(true);
  expect(files.some((f) => f.endsWith("b.jpg"))).toBe(true);
});
