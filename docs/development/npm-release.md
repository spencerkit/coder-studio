# npm 发布与工程化

## 发布物结构

当前仓库已经拆成以下发布结构：

- `packages/coder-studio`：主 npm 包，发布名为 `@spencer-kit/coder-studio`
- `packages/coder-studio-linux-x64`：Linux x64 运行时包
- `packages/coder-studio-darwin-arm64`：macOS Apple Silicon 运行时包
- `packages/coder-studio-darwin-x64`：macOS Intel 运行时包
- `packages/coder-studio-win32-x64`：Windows x64 运行时包

主包负责 CLI，平台包负责携带原生二进制和前端 `dist` 静态资源。

## CLI 用法

安装：

```bash
npm install -g @spencer-kit/coder-studio
```

常用命令：

```bash
coder-studio start
coder-studio stop
coder-studio restart
coder-studio status
coder-studio logs -f
coder-studio open
coder-studio doctor
coder-studio config show
coder-studio config validate
coder-studio auth status
coder-studio --version
```

可选参数：

- `--host`：默认 `127.0.0.1`
- `--port`：默认 `41033`
- `--foreground`：前台启动，适合调试和 E2E
- `--json`：结构化输出，适合脚本和 CI

详细命令说明见：`docs/development/cli.md`

## 本地状态目录

CLI 默认会在本机状态目录下写入运行信息：

- `runtime.json`
- `coder-studio.pid`
- `coder-studio.log`
- `config.json`
- `data/`

测试和隔离场景可以通过 `CODER_STUDIO_HOME` 覆盖状态目录。

## 构建命令

```bash
pnpm build:web
pnpm build:runtime
pnpm build:packages
pnpm pack:local
```

说明：

- `build:web`：构建前端到 `dist/`
- `build:runtime`：构建 Rust/Tauri release 二进制
- `build:packages`：把当前平台二进制和 `dist` 组装进平台包
- `pack:local`：生成本地主包和当前平台包 tarball 到 `.artifacts/`

## 版本管理

版本方案使用 `Changesets`。

关键命令：

```bash
pnpm changeset
pnpm changeset:version
```

版本同步脚本会自动把版本写入：

- `packages/*/package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- 根目录 `package.json`

## GitHub Actions

当前流水线分成三部分：

- `ci.yml`：PR 和主分支校验，跑 CLI 单测、Rust 校验、构建、smoke 和 release E2E
- `changesets.yml`：主分支自动生成版本 PR
- `release.yml`：基于 `v*` tag 发布平台包、主包，并创建 GitHub Release

## 本地测试链路

```bash
pnpm test:cli
pnpm test:smoke
pnpm test:e2e
pnpm test:e2e:release
```

覆盖范围：

- `test:cli`：CLI 配置、平台解析、状态目录等基础能力
- `test:smoke`：本地打包后真实安装 tarball，再执行 `start/status/restart/stop`
- `test:e2e`：开发态前后端联动验证
- `test:e2e:release`：release 二进制和静态资源启动后的浏览器 E2E
