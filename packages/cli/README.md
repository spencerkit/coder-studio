# @spencer-kit/coder-studio

Coder Studio CLI - Agent-First Development Environment

## 安装

```bash
npm install -g @spencer-kit/coder-studio
```

## 命令

### serve / server

启动 Coder Studio 服务器:

```bash
coder-studio serve [options]
coder-studio server
```

说明:
- `serve` 默认以后台托管模式启动服务
- `server` 是 `serve` 的别名
- 如果当前已有服务在运行，会先提示是否重启
- `serve --restart` 会直接重启当前托管服务，不再询问
- `serve --foreground` 会以前台模式启动服务

### open

启动服务并直接打开浏览器:

```bash
coder-studio open
```

说明:
- 如果服务未启动，会先启动再打开浏览器
- 如果服务已启动，会提示是否重启
- `open --restart` 会直接重启后再打开浏览器
- 选择不重启时，会直接打开当前运行中的地址
- 非交互场景下如果已有服务，不会自动重启，并会明确提示未重新启动

### status

查看当前托管服务状态:

```bash
coder-studio status
```

输出包含:
- 当前状态
- 监听 host / IP / port
- 完整监听 URL
- 本地访问 URL
- PID、启动时间、重启次数、日志路径

### version

显示版本号:

```bash
coder-studio version
```

### help

显示帮助信息:

```bash
coder-studio help
```

## 配置

### 认证

默认情况下，服务不需要认证。启用认证:

```bash
coder-studio config --password mypassword
```

### 数据目录

指定数据存储位置:

```bash
coder-studio config --data-dir /path/to/data
```

## Provider 支持

- **Claude** (Full mode) - 需要安装 Claude Code CLI
- **Codex** (Limited mode) - 需要安装 Codex CLI

## 许可证

MIT
