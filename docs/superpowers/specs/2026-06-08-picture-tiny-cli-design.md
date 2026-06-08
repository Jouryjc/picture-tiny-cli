# picture-tiny-cli 设计文档

- 日期：2026-06-08
- 状态：已确认，待实现
- 命令名：`ptiny`；包名：`picture-tiny-cli`

## 1. 目标与动机

提供一个**在 agent 中可靠调用**的图片压缩 CLI，能把图片压到：

- **目标文件体积**（如 ≤ 500KB），且
- **目标像素尺寸**（如 宽 1200px / 最长边 1600px），

两者可单独或组合使用，并在满足约束的前提下**最小程度影响画质**。

成功标准：

- 给定 `--max-size`，输出体积 ≤ 目标（不可达时尽力而为并明确标注）。
- 给定尺寸约束，分辨率被正确缩放（默认不放大）。
- stdout 始终是可被 agent 稳定解析的纯 JSON。
- 默认不破坏原文件。

## 2. 技术栈

- 运行时：**bun**（v1.3+），直接执行 TypeScript，无需构建步骤。
- 图像处理：**sharp**（libvips 内核，支持 JPEG/PNG/WebP/AVIF 的编码与质量控制）。
- 参数解析：内置 `util.parseArgs`（Node 兼容，零依赖）。
- 文件展开：`Bun.Glob`（零依赖）。
- 测试：内置 `bun test`。
- 唯一第三方运行时依赖：`sharp`。

> 实现第 0 步：先验证 sharp 在 bun 下能正常 `toBuffer()` 编码 JPEG/PNG/WebP/AVIF（唯一外部风险点）。若某格式（如 AVIF）在当前环境不可用，则在该格式上给出明确错误而非崩溃。

## 3. 核心算法：命中目标体积且画质最优

采用**二分搜索质量参数**：

1. 若有尺寸约束，先 resize（详见 §6）。
2. 若有 `--max-size`，在内存中反复用 sharp 以不同 `quality` 编码（`toBuffer()`，不落盘），二分逼近目标体积，取「输出 ≤ 目标的**最高** quality」。
   - 搜索区间 `[minQuality, 100]`，默认 `minQuality = 1`。
   - 用一次粗估（例如先编 `quality=80` 量一次体积）给二分一个更好的起点，减少迭代。
   - 收敛后约 7–8 次内存编码，单图毫秒~百毫秒级。
3. 若只给尺寸约束而无 `--max-size`：按高质量默认值（jpeg/webp/avif 默认 `quality=82`，png 默认近无损）直接编码一次。
4. 若给了 `--quality`：跳过体积搜索，按固定质量编码一次。
5. 若既无体积、无尺寸、无质量约束：视为用法错误（退出码 2）。

被否决的备选：

- 预测式单次编码（不够精确，常超标/过压）。
- 纯混合预测（复杂度高于收益）；本设计仅吸收「粗估起点」这一点优化。

## 4. CLI 接口

```
ptiny [options] <input...>

input...                          一个或多个：文件路径 / 目录 / glob（如 ./imgs/*.png）

目标约束（至少给一个；缺失视为用法错误）:
  --max-size <size>               目标最大体积，如 500kb / 1.5mb / 200000（纯数字=字节）
  --width <px>                    目标宽度
  --height <px>                   目标高度
  --max-side <px>                 限制最长边
  --quality <1-100>              固定质量（跳过体积搜索）

格式:
  --format <jpeg|png|webp|avif>   转换目标格式（默认：保留原格式）

输出:
  --output <file>                 单文件输出路径（仅当输入为单文件时允许）
  --out-dir <dir>                 批量输出目录（保留原文件名，按需改扩展名）
  --suffix <s>                    就地旁路输出后缀（默认 .min）
  --in-place                      覆盖原文件（必须显式开启）
  --recursive                     目录递归展开

行为:
  --background <color>            alpha→jpeg 压平底色（默认 white）
  --min-quality <n>               质量搜索下界（默认 1）
  --concurrency <n>               并发处理数（默认 = CPU 核数）
  --dry-run                       只计算不写文件

杂项:
  --help, --version
```

### 输出路径解析优先级

1. 单输入 + `--output` → 写到该路径。
2. `--out-dir` → 写到该目录，文件名沿用输入名（格式转换时改扩展名）。
3. `--in-place` → 覆盖原文件。
4. 以上都没有 → 在原文件旁写 `name{suffix}.ext`（默认 `name.min.ext`），**绝不静默覆盖原图**。

约束：多输入时禁止 `--output`（应使用 `--out-dir`），否则用法错误。

## 5. JSON 输出契约

stdout **始终**输出如下统一结构（单文件也包在 `results` 数组里）；日志/进度走 stderr。

```json
{
  "ok": true,
  "summary": {
    "count": 3, "ok": 3, "failed": 0,
    "originalBytes": 900000, "outputBytes": 320000,
    "savedBytes": 580000, "savedPercent": 64.4
  },
  "results": [
    {
      "input": "a.jpg",
      "output": "a.min.jpg",
      "ok": true,
      "originalFormat": "jpeg",
      "format": "jpeg",
      "originalWidth": 2400, "originalHeight": 1600,
      "width": 1200, "height": 800,
      "originalBytes": 500000, "outputBytes": 180000,
      "savedBytes": 320000, "savedPercent": 64.0, "ratio": 0.36,
      "quality": 78,
      "targetBytes": 200000, "reachedTarget": true,
      "iterations": 7,
      "warnings": []
    }
  ],
  "errors": [
    { "input": "broken.gif", "ok": false, "error": "animated images are not supported in v1" }
  ]
}
```

字段说明：

- `ratio` = `outputBytes / originalBytes`。
- `quality`：所选质量；纯无损路径（未做量化）时为 `null`。
- `reachedTarget`：给了 `--max-size` 时是否达标；尽力而为时为 `false` 并附 warning。
- `iterations`：二分搜索次数（无搜索时为 0）。
- 失败的文件进入 `errors`，不影响其它文件。

### 退出码

- `0`：全部文件成功。
- `1`：至少一个文件失败（仍输出完整 JSON）。
- `2`：用法/参数错误（也以 JSON 形式输出 `{ "ok": false, "error": "..." }`）。

## 6. 关键边界情况

- **目标体积不可达**：即使到 `min-quality` 仍超标 → 输出最小可得结果，`reachedTarget:false` + warning（`"could not reach target size; emitted best effort at quality N"`）。不硬失败。
- **PNG 无损命中体积**：PNG 的 `quality` 仅在调色板量化下有意义。命中体积走 `palette:true` + 二分 `quality`/`colors`；若最低量化仍超标，附 warning 建议 `--format webp`。
- **alpha 通道 → JPEG**：JPEG 无 alpha，按 `--background`（默认 white）压平。
- **动图**（GIF / 动画 WebP）：v1 不支持，明确报错进入 `errors`。
- **不放大**：尺寸约束大于原图时不放大，输出保持原尺寸并记录 warning。
- **不覆盖原图**：除非显式 `--in-place`。
- **输出格式与扩展名一致性**：`--format` 改变扩展名；输出路径相应调整。

## 7. 模块架构（单一职责、可独立测试）

| 文件 | 职责 | 依赖 |
|---|---|---|
| `src/size.ts` | 人类可读体积 ↔ 字节（`500kb`↔字节，约定 1KB=1024、1MB=1024²；纯数字按字节）；字节格式化 | 纯函数 |
| `src/args.ts` | 用 `util.parseArgs` 解析并校验为强类型 `Options`；用法错误抛出可读信息 | `size.ts` |
| `src/inputs.ts` | 把 文件/目录/glob 展开为去重的图片路径列表 | `Bun.Glob`, fs |
| `src/format.ts` | 探测原格式、选择目标编码器、封装各格式质量语义与默认值 | sharp |
| `src/compress.ts` | **核心**：输入 buffer + 选项 → 输出 buffer + 元数据；先 resize 后二分质量 | sharp, `format.ts` |
| `src/output.ts` | 依据选项解析单个输入的输出路径 | `args.ts` |
| `src/run.ts` | 单文件流水线（读→压→写→结果记录）与并发调度 | `compress.ts`, `output.ts` |
| `src/cli.ts` | 编排、收集结果、输出统一 JSON、设置退出码 | 以上全部 |
| `src/index.ts` | 库 API（`compressImage(buffer, options)` 等），供 agent 直接 import | `compress.ts` |
| `bin/ptiny` | `#!/usr/bin/env bun` 入口，转调 `src/cli.ts` | — |

## 8. 测试策略（TDD + bun test）

测试图**程序化生成**（sharp 造渐变/噪声图），不提交二进制 fixture。

- `size.ts`：`"500kb"`→`512000`、`"1.5mb"`、纯数字、非法输入；字节格式化。
- `compress.ts`：
  - 给定目标体积 → 输出 ≤ 目标且 `reachedTarget:true`。
  - resize 到指定宽 / 最长边，断言输出尺寸；不放大。
  - 格式转换（png→webp 等）。
  - alpha→jpeg 压平不报错且无 alpha。
  - PNG 量化命中较小体积。
  - 目标不可达 → 尽力而为 + `reachedTarget:false` + warning。
- `args.ts`：缺约束报用法错误；多输入 + `--output` 报错；非法 `--format`/`--quality`。
- `inputs.ts`：目录、glob、递归、去重。
- CLI 集成：对真实临时文件跑 `bin/ptiny`，解析 stdout JSON 并断言字段与退出码；验证 stdout 为纯 JSON（stderr 不污染）。

## 9. 非目标（YAGNI）

- 动图压缩（GIF/动画 WebP）。
- 批量并行的进度条 UI（仅 stderr 简单进度）。
- 云上传 / 远程源。
- 多目标体积的智能跨文件预算分配。
