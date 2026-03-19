# 部署文档

[English](README.en.md)

本目录说明如何把当前版本部署到公网可访问环境，同时启用已经实现的单口令鉴权。

## 当前部署能力

当前代码已经支持：

- 单用户单口令登录
- `HttpOnly` session cookie
- 同一 IP 在 `10` 分钟内连续 `3` 次口令错误后，封禁 `24` 小时
- `rootPath` 服务端单根目录白名单
- `HTTP RPC` 与 `WebSocket` 同时鉴权
- 非本地访问时要求通过 HTTPS 提交口令
- `localhost` / `127.0.0.1` / `::1` 访问时默认走非 public mode
- 本地访问时如果 URL 带 `?auth=force`，则强制走 public mode

## 推荐部署方式

推荐结构：

1. Coder Studio 进程监听本机回环地址
2. 由 `Caddy` 或 `Nginx` 在前面提供 HTTPS
3. 反向代理把 `/`、`/api`、`/ws`、`/health` 转发给本机 Coder Studio

推荐这样做的原因：

- 应用进程本身不做 TLS 终止
- 对外登录默认要求安全传输
- 反向代理更适合处理证书、域名和公开入口

## 配置文件

应用首次启动后，会在 app data 目录生成 `auth.json`。

常见位置：

- Linux：`~/.local/share/com.spencerkit.coderstudio/auth.json`
- macOS：`~/Library/Application Support/com.spencerkit.coderstudio/auth.json`
- Windows：`%AppData%\\com.spencerkit.coderstudio\\auth.json`

关键字段如下：

```json
{
  "version": 1,
  "publicMode": true,
  "password": "replace-this-passphrase",
  "rootPath": "/srv/coder-studio/workspaces",
  "bindHost": "127.0.0.1",
  "bindPort": 41033,
  "sessionIdleMinutes": 15,
  "sessionMaxHours": 12,
  "sessions": []
}
```

字段说明：

- `publicMode`：是否启用公开访问模式
- `password`：访问口令，当前按你的要求以明文保存在本地 JSON 中
- `rootPath`：允许通过 Web 界面访问和创建工作区的唯一根目录
- `bindHost`：传输服务监听地址
- `bindPort`：传输服务监听端口

说明：

- 旧版本 `allowedRoots` 仍然兼容读取
- 新版本 CLI 与运行时会统一写回 `rootPath`

## bindHost / bindPort 建议

推荐生产配置：

- `bindHost`: `127.0.0.1`
- `bindPort`: `41033`

这表示：

- 应用只监听本机
- 对外流量必须先经过 HTTPS 反向代理

如果你明确知道自己在做什么，也可以改成：

- `bindHost`: `0.0.0.0`

但即使这样，公网访问也仍然建议放在 HTTPS 反向代理后面，因为应用本身不直接提供 TLS。

## 反向代理要求

反向代理需要正确透传：

- `Host`
- `X-Forwarded-Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto`

其中 `X-Forwarded-Proto=https` 很关键，因为应用会用它判断当前是否为安全传输。

## Caddy 示例

```caddyfile
coder.example.com {
  reverse_proxy 127.0.0.1:41033
}
```

`Caddy` 默认会处理 WebSocket 和 HTTPS，适合作为最简单的公网入口。

## Nginx 示例

```nginx
server {
  listen 443 ssl http2;
  server_name coder.example.com;

  ssl_certificate /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:41033;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## 部署步骤

1. 构建应用：`pnpm tauri build`
2. 在目标机器上先启动一次应用，让它生成 `auth.json`
3. 编辑 `auth.json`，或者直接使用 CLI，至少设置：
   - `password`
   - `rootPath`
   - `bindHost`
   - `bindPort`
4. 重启应用
5. 配置 HTTPS 反向代理到 `bindHost:bindPort`
6. 打开你的域名，确认先出现登录页

推荐直接使用 CLI：

```bash
coder-studio config root set /srv/coder-studio/workspaces
printf '%s' 'replace-this-passphrase' | coder-studio config password set --stdin
coder-studio config auth public-mode on
coder-studio config set server.host 127.0.0.1
coder-studio config set server.port 41033
coder-studio restart
```

## 验证清单

- 访问域名时先看到口令登录页
- 口令错误 3 次后返回封禁提示
- 登录成功后可以正常建立 WebSocket
- 只能浏览 `rootPath` 下的目录
- `dialog_pick_folder` 在 public mode 下不可用
- 直接用 `http://localhost:41033` 本地访问时默认不走 public mode
- 直接用 `http://localhost:41033/?auth=force` 本地访问时会强制显示登录页

## 现在的边界

当前版本没有做：

- 多用户体系
- 密码修改界面
- 二次验证
- 审计日志
- 失败记录落盘

这些如果后面要补，建议单独做第二阶段设计。
