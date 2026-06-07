# Smoke Acceptance

> 第一轮验收索引。本文只记录可由模块功能 ID 反向生成的冒烟清单。

## 1. 目标

覆盖 Coder Studio 最小可用路径，验证应用能启动、打开 workspace、创建会话、编辑文件、查看 Git、使用终端。

## 2. 冒烟清单

| ID | 验收项 | 关联功能 ID | 建议方式 |
| --- | --- | --- | --- |
| SMOKE-001 | 应用启动并建立连接 | `APP-001`、`APP-002` | e2e / 手工 |
| SMOKE-002 | 认证门禁正确放行或拦截 | `AUTH-001`、`AUTH-002` | 单测 / e2e |
| SMOKE-003 | 打开 workspace | `WELCOME-002`、`WS-002`、`WS-004` | e2e / 手工 |
| SMOKE-004 | 文件树加载并打开文件 | `FILE-001`、`FILE-002` | e2e / 手工 |
| SMOKE-005 | 编辑并保存文本文件 | `EDITOR-002`、`FILE-003` | e2e / 手工 |
| SMOKE-006 | 创建 shell terminal 并输入命令 | `TERM-002`、`TERM-003` | e2e / 手工 |
| SMOKE-007 | 创建 Agent session | `PANE-004`、`SESSION-001` | e2e / 手工 |
| SMOKE-008 | 查看 Git 状态和 diff | `GIT-001`、`GIT-002` | e2e / 手工 |
| SMOKE-009 | 打开设置页并读取配置 | `SETTINGS-001`、`SETTINGS-003` | 单测 / 手工 |
| SMOKE-010 | 连接断开时显示状态 | `APP-005` | e2e / 手工 |

## 3. 未确认项

- Provider 真实运行冒烟需要稳定测试 provider 或 mock provider。
