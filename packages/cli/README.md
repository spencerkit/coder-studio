# @coder-studio/cli

Coder Studio CLI - Agent-First Development Environment

## 安装

```bash
npm install -g @coder-studio/cli
```

## 命令

### serve

启动 Coder Studio 服务器:

```bash
coder-studio serve [options]
```

选项:
- `--port, -p <number>` - 服务端口 (默认: 4173)
- `--host, -h <string>` - 服务主机 (默认: 127.0.0.1)
- `--data-dir, -d <path>` - 数据存储目录
- `--password <string>` - 启用密码认证
- `--no-auth` - 禁用认证

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
coder-studio serve --password mypassword
```

### 数据目录

指定数据存储位置:

```bash
coder-studio serve --data-dir /path/to/data
```

## Provider 支持

- **Claude** (Full mode) - 需要安装 Claude Code CLI
- **Codex** (Limited mode) - 需要安装 Codex CLI

## 许可证

MIT