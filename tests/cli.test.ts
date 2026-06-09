import { test, expect } from "bun:test";
import sharp from "sharp";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function noiseRaw(w: number, h: number, c: number): Buffer {
  const data = Buffer.alloc(w * h * c);
  let x = 2024;
  for (let i = 0; i < data.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    data[i] = x % 256;
  }
  return data;
}

async function runCli(args: string[]): Promise<{ code: number; json: any; stdout: string }> {
  const proc = Bun.spawn(["bun", "bin/ptiny", ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, json: JSON.parse(stdout), stdout };
}

test("compresses a real file to target size, stdout is pure JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptiny-cli-"));
  const input = join(dir, "in.jpg");
  const buf = await sharp(noiseRaw(700, 700, 3), { raw: { width: 700, height: 700, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
  await writeFile(input, buf);

  const { code, json } = await runCli([input, "--max-size", "20kb", "--out-dir", dir]);
  expect(code).toBe(0);
  expect(json.ok).toBe(true);
  expect(json.summary.count).toBe(1);
  expect(json.results[0].outputBytes).toBeLessThanOrEqual(20 * 1024);
  expect(json.results[0].reachedTarget).toBe(true);
});

test("usage error returns code 2 and JSON error", async () => {
  const { code, json } = await runCli(["only-input-no-constraint.jpg"]);
  expect(code).toBe(2);
  expect(json.ok).toBe(false);
  expect(json.error).toMatch(/at least one/);
});

test("--version prints JSON and exits 0", async () => {
  const { code, json } = await runCli(["--version"]);
  expect(code).toBe(0);
  expect(json.version).toBeTruthy();
});

test("partial failure yields exit code 1 with errors[]", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ptiny-cli-"));
  const good = join(dir, "good.jpg");
  const buf = await sharp(noiseRaw(200, 200, 3), { raw: { width: 200, height: 200, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
  await writeFile(good, buf);
  // .png extension passes the input filter but the bytes are not a real image,
  // so it expands successfully yet fails during compression.
  const corrupt = join(dir, "corrupt.png");
  await writeFile(corrupt, "this is not a real png");

  const { code, json } = await runCli([good, corrupt, "--quality", "60", "--out-dir", dir]);
  expect(code).toBe(1);
  expect(json.ok).toBe(false);
  expect(json.summary.ok).toBe(1);
  expect(json.summary.failed).toBe(1);
  expect(json.errors.length).toBe(1);
});
