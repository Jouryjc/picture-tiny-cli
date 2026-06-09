# picture-tiny-cli (`ptiny`)

在 agent 中可靠调用的图片压缩 CLI：压到目标文件体积和/或像素尺寸，最小程度影响画质，stdout 始终输出纯 JSON。

## 安装

```bash
bun install
```

## 用法

```bash
# 压到 500KB 以内，保留原格式
bun bin/ptiny photo.jpg --max-size 500kb

# 限制最长边 1600px 并转 webp，输出到目录
bun bin/ptiny ./imgs/*.png --max-side 1600 --format webp --out-dir ./out

# 同时限定体积与尺寸
bun bin/ptiny photo.jpg --max-size 300kb --max-side 1920
```

## 选项

见 `bun bin/ptiny --help`。

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
