# CLI 参考

这篇文档介绍 Coder Studio 命令行接口的用法。CLI 用于管理服务的生命周期，日常使用中你更多通过浏览器界面与产品交互。

## 这篇文档解决什么问题

快速查找和了解 Coder Studio 的所有 CLI 命令及其用法。

## 前置条件

- 已安装 Coder Studio：`npm install -g @spencer-kit/coder-studio`
- 终端中可以执行 `coder-studio help`

## 命令列表

### coder-studio open

启动服务（如未运行）并在浏览器中打开 Coder Studio。

```bash
coder-studio open
coder-studio open --restart  # 强制重启后打开
```

### coder-studio serve

pm2 已经是内置依赖，开箱即用。

```bash
coder-studio serve                   # 后台启动
coder-studio serve --foreground      # 前台启动，适合调试
coder-studio serve --restart         # 重启已有服务
coder-studio server                  # serve 的别名
```

### coder-studio status

查看当前服务的运行状态。

```bash
coder-studio status
```

输出包括：状态、监听的 URL、PID、启动时间、日志路径等。

### coder-studio logs

查看服务的日志输出。

```bash
coder-studio logs
```

### coder-studio stop

停止当前托管的 Coder Studio 服务。

```bash
coder-studio stop
```

### coder-studio config

查看或修改持久化配置。这些配置会被 `serve` 和 `open` 在下次启动时读取。

```bash
# 查看当前配置
coder-studio config

# 修改配置
coder-studio config --host 0.0.0.0
coder-studio config --port 8080
coder-studio config --state-dir /path/to/data
coder-studio config --password mypassword
```

### coder-studio auth

管理认证登录封禁。

```bash
# 查看被封禁的 IP
coder-studio auth ban-list

# 解封指定 IP
coder-studio auth unblock --ip 192.168.1.100
```

### coder-studio help

显示完整的帮助信息，包括所有命令和选项。

```bash
coder-studio help
```

### coder-studio version

显示 Coder Studio 版本号。

```bash
coder-studio version
```

## 日常使用推荐

```bash
coder-studio open    # 启动并打开浏览器（最常用）
coder-studio status  # 随时检查服务状态
coder-studio logs    # 出问题时查看日志
coder-studio stop    # 停止服务
```

## 常见命令组合

```bash
# 修改端口后重启
coder-studio config --port 3000
coder-studio serve --restart

# 前台模式调试
coder-studio serve --foreground

# 查看配置后检查状态
coder-studio config
coder-studio status
```

## 常见问题

**Q：serve 和 open 有什么区别？**
`serve` 只启动服务，`open` 会启动服务并在浏览器中打开。

**Q：必须用后台模式吗？**
不是。`serve --foreground` 以前台模式运行，不需要 pm2，适合调试或容器场景。

**Q：pm2 是必须的吗？**
后台托管模式（`coder-studio serve`）需要 pm2，pm2 已经是内置依赖，开箱即用。如果不想让服务在后台运行，可以使用前台模式 `serve --foreground`。
