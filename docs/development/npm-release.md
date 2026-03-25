# npm 发布与工程化

## 发布物结构

当前仓库已经拆成以下发布结构：

- `packages/cli`：主 npm 包源码与发布元数据，发布名为 `@spencer-kit/coder-studio`
- `packages/cli/src`：CLI TypeScript 源码
- `templates/npm/platform-packages/*`：平台包模板
- `.build/cli`：CLI 编译产物
- `.build/stage/npm/*`：主包与平台包 staging 目录
- `.artifacts/`：最终 tarball、manifest、checksum

分层职责：

- 源码层：`packages/cli`、`packages/cli/src`、`apps/web`、`apps/server`
- 模板层：`templates/npm/platform-packages/*`
- 产物层：`.build/web/dist`、`.build/server/target`、`.build/cli`、`.build/stage/npm/*`、`.artifacts/`

主包源码负责 CLI 的 TypeScript 实现，`.build/cli` 承接编译结果，平台包模板负责发布元数据，staging 目录负责承接真正可发布的 npm 包内容。

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
pnpm version:check
pnpm build:web
pnpm build:server
pnpm build:cli
pnpm build:packages
pnpm pack:local
pnpm release:verify
pnpm release:verify:full
```

说明：

- `version:check`：校验根包、主包、平台包、`Cargo.toml` 版本是否完全一致
- `build:web`：构建前端到 `.build/web/dist`
- `build:server`：构建 Rust release 二进制到 `.build/server/target`
- `build:cli`：把 `packages/cli/src` 编译到 `.build/cli`
- `build:packages`：生成 `.build/stage/npm/coder-studio` 和当前平台的 `.build/stage/npm/<platform>`，分别注入 CLI 编译产物与原生二进制/前端产物
- `pack:local`：执行 release 构建后，生成本地主包和当前平台包 tarball 到 `.artifacts/`
- `release:verify`：跑版本校验、CLI 单测、Rust 单测、本地打包和 smoke
- `release:verify:full`：在 `release:verify` 基础上追加 release E2E

## 版本管理

版本方案使用 `Changesets`。

关键命令：

```bash
pnpm changeset
pnpm changeset:version
```

建议流程：

```bash
pnpm changeset
pnpm changeset:version
git add .
git commit -m "chore(release): version packages"
```

版本同步脚本会自动把版本写入：

- `packages/cli/package.json`
- `templates/npm/platform-packages/*/package.json`
- `apps/server/Cargo.toml`
- 根目录 `package.json`

`changeset:version` 现在会在同步后自动执行 `pnpm version:check`，确保版本没有漂移。

## 本地发布前检查

最小发布检查：

```bash
pnpm release:verify
```

完整发布检查：

```bash
pnpm release:verify:full
```

本地打包产物：

```bash
pnpm pack:local
ls .artifacts
```

当前 `.artifacts/` 会包含：

- 主包 tarball
- 当前平台包 tarball
- `release-manifest.json`
- `SHA256SUMS.txt`

而 `.build/stage/npm/` 会包含：

- `coder-studio`：主包 staging 目录
- `<platform>`：当前平台运行时包 staging 目录

## GitHub Actions

当前流水线分成三部分：

- `ci.yml`
  - 增加 `version-consistency` 检查
  - 跑跨平台 CLI 单测
  - 在 Linux 跑 Rust fmt/clippy/check/test
  - 执行 `pnpm pack:local`
  - 跑 smoke 和 release E2E
  - 上传 Linux 本地 release tarball 工件
- `changesets.yml`
  - 只在 `main` 上运行
  - 自动创建或更新版本 PR
  - 已补齐 `contents` / `pull-requests` 写权限
- `release.yml`
  - 先执行 `preflight` 校验 tag 与版本一致，并跑 `pnpm version:check`
  - 再按平台矩阵从 `.build/stage/npm/*` 发布 4 个运行时包
  - 再从 `.build/stage/npm/coder-studio` 发布主包 `@spencer-kit/coder-studio`
  - 最后汇总 tarball，生成 `release-manifest.json` 和 `SHA256SUMS.txt`，附加到 GitHub Release

## 发布触发方式

版本 PR 合并后，使用对应版本号打 tag：

```bash
git tag v0.1.0
git push origin v0.1.0
```

触发后：

1. `release.yml` 校验 tag 是否等于 `packages/cli/package.json` 当前版本
2. 从模板生成 staging 包并发布平台包
3. 发布主包
4. 生成 GitHub Release 附件

## GitHub / npm 配置要求

当前 release workflow 依赖：

- GitHub Actions 默认 `GITHUB_TOKEN`
- 仓库 secret：`NPM_TOKEN`

`NPM_TOKEN` 需要具备发布 `@spencer-kit/*` 包到 npm 的权限。

## 本地测试链路

```bash
pnpm test:cli
pnpm test:smoke
pnpm test:e2e
pnpm test:e2e:release
pnpm test:smoke:windows:transport
```

如果当前 Windows 机器没有可用的 WSL，可以临时执行：`pnpm test:smoke:windows:transport -- --skip-wsl-preflight`；指定 distro 则用 `-- --wsl-distro Ubuntu`。

CI 里默认的 GitHub-hosted Windows 烟测会跳过这一步 WSL 预检；如果你已经有带 WSL 的自托管 Windows runner，可以手动触发 `Windows WSL Smoke` workflow。这个 workflow 需要 runner 带有 `self-hosted`、`windows`、`x64`、`wsl` 标签，并且会执行完整的 WSL 预检；如果要固定 distro，可以在 workflow input 里填写 `wsl_distro`。

覆盖范围：

- `test:cli`：CLI 配置、平台解析、状态目录等基础能力
- `test:cli` 现在额外覆盖 release 版本一致性和 release manifest 生成
- `test:smoke`：本地打包后真实安装 tarball，再执行 `start/status/restart/stop`
- `test:e2e`：开发态前后端联动验证
- `test:e2e:release`：release 二进制和静态资源启动后的浏览器 E2E
- `test:smoke:windows:transport`：Windows 真机烟测；默认会先做 WSL `wslpath -w` 预检，再跑 transport 相关 Rust / Web / E2E 校验
