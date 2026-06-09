# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.1] - 2026-06-09

### Added
- `repository` / `homepage` / `bugs` 元数据，指向 GitHub 仓库。

### Notes
- 相比 0.1.0 无功能变更，仅打包与元数据完善。

## [0.1.0] - 2026-06-09

### Added
- 首个版本。
- 通过对编码质量做二分搜索命中目标文件体积（`--max-size`），在不超体积的前提下保留最高画质。
- 通过 `--max-side` / `--width` / `--height` 缩放尺寸（绝不放大）。
- 格式转换：JPEG / PNG / WebP / AVIF（`--format`），默认保留原格式。
- 纯 JSON 输出（summary + 每文件结果），退出码 `0` / `1` / `2`。
- 批量输入（文件 / 目录 / glob）+ 受限并发。
- 安全：默认不覆盖原图、检测输出路径冲突、明确拒绝动图。
