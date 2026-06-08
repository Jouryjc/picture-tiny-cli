import { Glob } from "bun";
import { stat, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif", ".gif", ".tiff", ".tif"]);

function isGlob(s: string): boolean {
  return /[*?[\]{}]/.test(s);
}

async function listDir(dir: string, recursive: boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive) files.push(...(await listDir(full, recursive)));
    } else {
      files.push(full);
    }
  }
  return files;
}

/** 把输入项（文件/目录/glob）展开为去重、排序后的图片路径列表。 */
export async function expandInputs(inputs: string[], recursive: boolean): Promise<string[]> {
  const out = new Set<string>();
  for (const item of inputs) {
    if (isGlob(item)) {
      const glob = new Glob(item);
      for await (const file of glob.scan({ onlyFiles: true })) out.add(file);
      continue;
    }
    let st;
    try {
      st = await stat(item);
    } catch {
      throw new Error(`input not found: ${item}`);
    }
    if (st.isDirectory()) {
      for (const f of await listDir(item, recursive)) {
        if (IMAGE_EXTS.has(extname(f).toLowerCase())) out.add(f);
      }
    } else {
      out.add(item);
    }
  }
  return [...out].sort();
}
