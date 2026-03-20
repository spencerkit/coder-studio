# CLI 命令手册

[English](cli.en.md)

本文记录 `@spencer-kit/coder-studio` npm 包当前已经实现的 CLI 能力，只描述代码里现在可用的命令与行为。

## 安装

```bash
npm install -g @spencer-kit/coder-studio
```

安装后可用入口命令：

```bash
coder-studio
```

## 目录与文件

CLI 会维护两层本地目录：

- `stateDir`：CLI 自己的状态目录，保存 `runtime.json`、`coder-studio.pid`、`coder-studio.log`、`config.json`
- `dataDir`：运行时数据目录，默认位于 `stateDir/data`，保存 `auth.json`、数据库等运行数据

默认情况下：

- Linux：`~/.local/state/coder-studio`
- macOS：`~/Library/Application Support/coder-studio`
- Windows：`%LOCALAPPDATA%\coder-studio`

可通过环境变量覆盖：

- `CODER_STUDIO_HOME`：覆盖 `stateDir`
- `CODER_STUDIO_DATA_DIR`：覆盖 `dataDir`

查看当前路径：

```bash
coder-studio config path
```

## 命令总览

运行时控制：

```bash
coder-studio start
coder-studio stop
coder-studio restart
coder-studio status
coder-studio logs -f
coder-studio open
coder-studio doctor
```

配置管理：

```bash
coder-studio config show
coder-studio config get server.port
coder-studio config set server.port 41033
coder-studio config root set /srv/coder-studio/workspaces
coder-studio config password set --stdin
coder-studio config validate
```

鉴权运维：

```bash
coder-studio auth status
coder-studio auth ip list
coder-studio auth ip unblock 203.0.113.12
coder-studio auth ip unblock --all
```

Shell Completion：

```bash
coder-studio completion bash
coder-studio completion zsh
coder-studio completion fish
coder-studio completion install bash
```

版本信息：

```bash
coder-studio --version
```

帮助：

```bash
coder-studio help
coder-studio help start
coder-studio help config
coder-studio help auth
coder-studio help completion
```

## 全局参数

大部分运行时命令支持：

- `--json`：输出结构化 JSON，适合脚本或 CI
- `--host`：覆盖本次命令使用的服务地址
- `--port`：覆盖本次命令使用的服务端口

部分命令额外支持：

- `start --foreground`：前台启动运行时，适合调试
- `logs -f`：持续跟随日志输出
- `logs -n <lines>`：指定读取的日志行数
- `config password set --stdin`：从标准输入读取口令
- `auth ip unblock --all`：一次解除全部当前封禁 IP

## Shell Completion

CLI 可以输出 `bash`、`zsh`、`fish` 的补全脚本，命令本身只负责把脚本打印到标准输出。

直接打印脚本：

```bash
coder-studio completion bash
coder-studio completion zsh
coder-studio completion fish
```

即时加载：

```bash
eval "$(coder-studio completion bash)"
source <(coder-studio completion zsh)
coder-studio completion fish | source
```

自动安装到本地 shell 配置：

```bash
coder-studio completion install bash
coder-studio completion install zsh
coder-studio completion install fish
```

安装行为：

- `bash`：写入 `~/.coder-studio/completions/coder-studio.bash`，并在 `~/.bashrc` 注入受管的 `source` 片段
- `zsh`：写入 `~/.coder-studio/completions/coder-studio.zsh`，并在 `~/.zshrc` 注入受管的 `source` 片段
- `fish`：写入 `${XDG_CONFIG_HOME:-~/.config}/fish/completions/coder-studio.fish`，不修改 profile

手动持久化安装示例：

```bash
coder-studio completion bash >> ~/.bashrc
coder-studio completion zsh > ~/.zfunc/_coder-studio
coder-studio completion fish > ~/.config/fish/completions/coder-studio.fish
```

说明：

- `coder-studio completion install <shell> --json` 会返回安装结果
- `coder-studio completion <shell>` 不支持 `--json`
- `coder-studio help completion` 可查看命令说明

## 退出码

- `0`：执行成功
- `1`：运行时或操作失败
- `2`：命令用法、参数或输入值错误

## 运行时命令

### `start`

启动本地运行时。如果运行时已经在目标 `stateDir` 下启动，则直接返回当前状态。

```bash
coder-studio start
coder-studio start --foreground
coder-studio start --json
```

说明：

- 默认读取当前配置中的 `server.host` 和 `server.port`
- 如果配置了 `system.openCommand`，不会影响 `start`，只影响 `open`

### `stop`

停止当前由 CLI 管理的运行时。

```bash
coder-studio stop
coder-studio stop --json
```

### `restart`

停止后重新启动运行时。

```bash
coder-studio restart
```

### `status`

查询运行时状态。

```bash
coder-studio status
coder-studio status --json
```

输出包含：

- 当前状态：`running` / `degraded` / `stopped`
- 是否由当前 CLI 管理
- 监听地址
- PID
- `stateDir`
- 日志路径

### `logs`

读取或跟随运行时日志。

```bash
coder-studio logs
coder-studio logs -n 200
coder-studio logs -f
```

说明：

- 未显式指定 `-n` 时，默认使用 `logs.tailLines`
- `logs.tailLines` 默认值是 `80`

### `open`

在默认浏览器里打开运行中的服务地址；如果运行时未启动，会先启动再打开。

```bash
coder-studio open
```

说明：

- 默认使用系统打开方式
- 如果配置了 `system.openCommand`，则优先使用该命令打开 URL

### `doctor`

输出运行时、二进制包、状态目录和日志的诊断信息。

```bash
coder-studio doctor
coder-studio doctor --json
```

## `config` 命令

### 子命令

```bash
coder-studio config path
coder-studio config show
coder-studio config get <key>
coder-studio config set <key> <value>
coder-studio config unset <key>
coder-studio config validate
coder-studio config root show
coder-studio config root set <path>
coder-studio config root clear
coder-studio config password status
coder-studio config password set <value>
coder-studio config password set --stdin
coder-studio config password clear
coder-studio config auth public-mode <on|off>
coder-studio config auth session-idle <minutes>
coder-studio config auth session-max <hours>
```

### 支持的配置键

- `server.host`
- `server.port`
- `root.path`
- `auth.publicMode`
- `auth.password`
- `auth.sessionIdleMinutes`
- `auth.sessionMaxHours`
- `system.openCommand`
- `logs.tailLines`

### 配置键说明

- `server.host`：运行时监听地址
- `server.port`：运行时监听端口
- `root.path`：前端在 public mode 下可访问的唯一根目录
- `auth.publicMode`：是否启用公网访问鉴权模式
- `auth.password`：访问口令；CLI 不会明文展示，只能查看是否已配置
- `auth.sessionIdleMinutes`：会话空闲超时分钟数
- `auth.sessionMaxHours`：会话绝对最长时长，单位小时
- `system.openCommand`：`open` 命令使用的外部打开命令
- `logs.tailLines`：`logs` 命令默认读取的尾部行数

### 存储位置

CLI 对外只暴露一套配置视图，但底层分成两个文件：

- `config.json`：CLI 自身行为
  - `system.openCommand`
  - `logs.tailLines`
- `auth.json`：运行时鉴权与服务配置
  - `server.host`
  - `server.port`
  - `root.path`
  - `auth.publicMode`
  - `auth.password`
  - `auth.sessionIdleMinutes`
  - `auth.sessionMaxHours`

### 行为说明

- `root.path` 会以单根目录模型写入 `auth.json` 的 `rootPath`
- 旧版本 `allowedRoots` 配置仍可读取，但 CLI 写回时只会写 `rootPath`
- `auth.password` 在 `show` / `get` 中不会返回明文
- 运行时已经启动时：
  - `root.path`、`auth.publicMode`、`auth.password`、会话时长配置会即时写入并立即生效
  - `server.host`、`server.port` 会写入配置，但需要 `restart` 后才会真正改变监听地址
- 修改 `auth.password` 或 `auth.publicMode` 时，当前活跃登录会话会被清空

### 常用示例

设置公网模式的最小配置：

```bash
coder-studio config root set /srv/coder-studio/workspaces
printf '%s' 'replace-this-passphrase' | coder-studio config password set --stdin
coder-studio config auth public-mode on
```

切换监听端口并重启：

```bash
coder-studio config set server.port 42033
coder-studio restart
```

查看当前配置：

```bash
coder-studio config show
coder-studio config validate
```

## `auth` 命令

### 子命令

```bash
coder-studio auth status
coder-studio auth ip list
coder-studio auth ip unblock <ip>
coder-studio auth ip unblock --all
```

### `auth status`

输出当前鉴权运行状态：

- 运行时是否启动
- 当前 `server.host` / `server.port`
- 当前 `root.path`
- `auth.publicMode`
- 口令是否已配置
- 会话时长配置
- 当前封禁 IP 数量

### `auth ip list`

查看当前正在封禁中的 IP 列表。

说明：

- 这里只展示正在封禁中的 IP
- 当前封禁状态保存在内存中，不会落盘
- 运行时停止后，封禁列表自然清空

### `auth ip unblock`

解除指定 IP 或全部 IP 的封禁。

```bash
coder-studio auth ip unblock 203.0.113.12
coder-studio auth ip unblock --all
```

## 推荐操作流

本地开发：

```bash
coder-studio start
coder-studio open
coder-studio status
```

公网部署前初始化：

```bash
coder-studio config root set /srv/coder-studio/workspaces
printf '%s' 'replace-this-passphrase' | coder-studio config password set --stdin
coder-studio config auth public-mode on
coder-studio config set server.host 127.0.0.1
coder-studio config set server.port 41033
coder-studio restart
coder-studio auth status
```

封禁巡检：

```bash
coder-studio auth ip list
coder-studio auth ip unblock --all
```
