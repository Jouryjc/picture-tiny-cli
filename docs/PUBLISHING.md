# 发布 `compressing-images` skill 到 Claude Code 市场

> 现状：仓库纯本地、无 GitHub 远程；`ptiny` 只能在本仓库内（依赖本地 `node_modules/sharp`）运行。
> 要让别人装上就能用，需要两件事：**(A) 让 `ptiny` 能独立安装**，**(B) 把 skill 打包成插件并通过市场分发**。

---

## 核心认知

- Claude Code 的 skill 必须**包进插件**（仓库根加 `.claude-plugin/plugin.json`）才能进市场；`skills/` 放在插件根目录（本仓库已就位）。
- 一个 GitHub 仓库可以**既是插件又是市场**（再加 `.claude-plugin/marketplace.json`）。
- 插件只分发「文件 + skill 说明」，**不会在用户机器上跑 `bun install`**。所以 `compressing-images` 依赖的 `ptiny`（bun + 原生 sharp）必须能被用户独立装上 —— 这就是 Part A 的意义。

---

## Part A —— 让 `ptiny` 可独立安装（发布到 npm）

`bin/ptiny` 的 shebang 是 `#!/usr/bin/env bun`，运行时需要 **bun + sharp**。发布到 npm 后，有 bun 的用户即可：

```bash
bunx picture-tiny-cli photo.jpg --max-size 200kb     # 免安装直接用（推荐）
# 或
npm i -g picture-tiny-cli                              # 全局装，之后 `ptiny ...`（PATH 上需有 bun）
```

发布步骤：

1. 完善 `package.json`（确认 `name` 在 npm 未被占用、`version`、`bin`、加上 `files` 白名单避免把测试/文档打进包）：
   ```jsonc
   {
     "name": "picture-tiny-cli",
     "version": "0.1.0",
     "bin": { "ptiny": "bin/ptiny" },
     "files": ["bin", "src", "README.md"],
     "dependencies": { "sharp": "^0.34.0" }
   }
   ```
2. `npm login`（或 `bun pm whoami` 确认已登录）。
3. `npm publish --access public`（或 `bun publish`）。
4. 验证：`bunx picture-tiny-cli@latest --version`。

> 备注：若想让**没有 bun 的纯 Node 用户**也能用，需要加构建步骤（把 `src` 编译/打包，shebang 改 `#!/usr/bin/env node`）。当前面向 bun 用户已够用。

发布后，把 `skills/compressing-images/SKILL.md` 的 **Setup** 一节改成「`bunx picture-tiny-cli` / `npm i -g picture-tiny-cli`」，去掉本地路径假设。

---

## Part B —— 打包成插件 + 自建市场

### 1. 加插件清单 `.claude-plugin/plugin.json`

```json
{
  "name": "picture-tiny",
  "description": "Compress images to a target file size and/or pixel dimensions with minimal quality loss (ptiny / bun + sharp). Supports JPEG/PNG/WebP/AVIF.",
  "version": "0.1.0",
  "author": { "name": "<你的名字>", "email": "<你的邮箱>" },
  "homepage": "https://github.com/<用户名>/picture-tiny-cli",
  "repository": { "type": "git", "url": "https://github.com/<用户名>/picture-tiny-cli.git" },
  "license": "MIT"
}
```

- skill 调用名会变成 `/picture-tiny:compressing-images`。
- 命名用小写连字符；`version` 省略时用 git commit SHA。

### 2. 加市场清单 `.claude-plugin/marketplace.json`（同仓库既是插件又是市场）

```json
{
  "version": "1.0.0",
  "plugins": [
    {
      "name": "picture-tiny",
      "description": "Compress images to a target size/dimensions with minimal quality loss.",
      "version": "0.1.0",
      "source": { "type": "git", "url": ".", "commit": "main" }
    }
  ]
}
```

> ⚠️ 不要把 `skills/`、`commands/` 等放进 `.claude-plugin/` 目录里——它们应在**插件根目录**（现状正确）。

### 3. 本地验证

```bash
claude plugin validate                # 校验清单合法
claude --plugin-dir .                 # 临时加载本插件，跑 /picture-tiny:compressing-images 验证
```

### 4. 推到 GitHub（前提：仓库目前无远程）

```bash
gh repo create picture-tiny-cli --public --source=. --remote=origin --push
# 或手动：git remote add origin git@github.com:<用户名>/picture-tiny-cli.git && git push -u origin main
```

### 5. 别人安装

```bash
/plugin marketplace add <用户名>/picture-tiny-cli
/plugin install picture-tiny@picture-tiny-cli
# 然后照 skill 的 Setup 装 ptiny：bunx picture-tiny-cli / npm i -g picture-tiny-cli
```

更新：推新 commit、bump `plugin.json` 的 `version`，用户 `/plugin marketplace update`。

---

## Part C —— （可选）提交到 Anthropic 社区市场

更大曝光，走官方审核：

1. `claude plugin validate` 通过。
2. 在 https://claude.ai/settings/plugins/submit （或 https://platform.claude.com/plugins/submit ）填写提交表单。
3. Anthropic 自动安全检查 + 人工审核；通过后插件被 pin 到某个 commit，进入 `anthropics/claude-plugins-community`。
4. 用户：
   ```bash
   /plugin marketplace add anthropics/claude-plugins-community
   /plugin install picture-tiny@claude-community
   ```

---

## 官方文档

- 插件创建：https://code.claude.com/docs/en/plugins
- 市场分发：https://code.claude.com/docs/en/plugin-marketplaces
- 插件参考：https://code.claude.com/docs/en/plugins-reference
- 发现/安装插件：https://code.claude.com/docs/en/discover-plugins
