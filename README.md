# picture-tiny-cli (`ptiny`)

[![npm version](https://img.shields.io/npm/v/picture-tiny-cli.svg)](https://www.npmjs.com/package/picture-tiny-cli)
[![npm downloads](https://img.shields.io/npm/dm/picture-tiny-cli.svg)](https://www.npmjs.com/package/picture-tiny-cli)
[![CI](https://github.com/Jouryjc/picture-tiny-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Jouryjc/picture-tiny-cli/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/npm/l/picture-tiny-cli.svg)](./LICENSE)

在 agent 中可靠调用的图片压缩 CLI：压到目标文件体积和/或像素尺寸，**最小程度影响画质**，stdout 始终输出纯 JSON。

> **运行时要求：bun。** `ptiny` 以 bun 执行 TypeScript 源码（依赖原生 `sharp`）。请先安装 [bun](https://bun.sh)。

## ✨ 特性

- 🎯 **命中目标体积** — `--max-size 500kb` 对编码质量做二分搜索，取「不超体积下的最高画质」，优于手动猜质量
- 📐 **限定尺寸** — `--max-side` / `--width` / `--height` 等比缩放，**绝不放大**
- 🔄 **格式转换** — JPEG / PNG / WebP / AVIF，默认保留原格式，`--format` 可转
- 🤖 **agent 友好** — 纯 JSON 输出 + 退出码 `0/1/2`，stderr 不污染 stdout
- 🛡️ **安全** — 默认不覆盖原图、检测批量输出路径冲突、alpha→jpeg 自动压平、动图明确拒绝
- ⚡ **批量 + 并发** — 文件 / 目录 / glob，受限并发

## 安装 / 使用

```bash
# 免安装直接用（推荐）
bunx picture-tiny-cli photo.jpg --max-size 500kb

# 或全局安装后用 ptiny（PATH 上需有 bun）
bun add -g picture-tiny-cli      # 或 npm i -g picture-tiny-cli
ptiny photo.jpg --max-size 500kb
```

```bash
# 压到 500KB 以内，保留原格式
ptiny photo.jpg --max-size 500kb

# 限制最长边 1600px 并转 webp，输出到目录
ptiny ./imgs/*.png --max-side 1600 --format webp --out-dir ./out

# 同时限定体积与尺寸
ptiny photo.jpg --max-size 300kb --max-side 1920
```

## 选项

至少给一个目标约束：`--max-size` / `--width` / `--height` / `--max-side` / `--quality`。完整列表见 `ptiny --help`。

| 选项 | 说明 |
|---|---|
| `--max-size <500kb\|1.5mb\|N>` | 目标最大体积（二分搜索质量），1KB=1024 |
| `--max-side <px>` | 限制最长边（缩放，不放大） |
| `--width <px>` / `--height <px>` | 目标宽 / 高 |
| `--quality <1-100>` | 固定质量，跳过体积搜索 |
| `--format <jpeg\|png\|webp\|avif>` | 转换格式（默认保留原格式） |
| `--out-dir <dir>` / `--output <file>` | 输出目录 / 单文件输出路径 |
| `--in-place` | 覆盖原文件（否则写 `<name>.min.<ext>`） |
| `--dry-run` | 只计算不写文件 |
| `--concurrency <n>` / `--recursive` / `--suffix <s>` | 批量相关 |

## 输出（JSON）

```json
{
  "ok": true,
  "summary": { "count": 1, "ok": 1, "failed": 0, "savedPercent": 64.0 },
  "results": [
    { "input": "photo.jpg", "output": "photo.min.jpg", "ok": true,
      "outputBytes": 180000, "quality": 78, "reachedTarget": true, "warnings": [] }
  ],
  "errors": []
}
```

退出码：全成功 `0`，部分失败 `1`，用法错误 `2`。

## 库用法

```ts
import { compressImage } from "picture-tiny-cli";
const out = await compressImage(buffer, { maxSize: 200 * 1024, maxSide: 1600 });
```

## 开发

```bash
bun install
bun test          # 46 个测试，覆盖体积搜索 / 缩放 / 格式转换 / 边界
bun bin/ptiny --help
```

## 贡献

欢迎 issue 与 PR：<https://github.com/Jouryjc/picture-tiny-cli/issues>

## 许可证

[MIT](./LICENSE) © jouryjc
