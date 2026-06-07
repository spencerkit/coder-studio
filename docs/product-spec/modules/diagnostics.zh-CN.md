# Diagnostics

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 诊断页。
- 系统依赖状态和安装流程。
- diagnostics get/recheck。

不覆盖：
- Provider runtime status 细节。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Diagnostics page | Both | 查看系统诊断结果。 |
| System dependency install panel | Both | 安装缺失依赖，处理交互输入。 |
| Settings 或引导入口 | Both | 可能跳转到诊断页。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| DIAG-001 | 诊断页渲染 | Implemented | `packages/web/src/features/diagnostics/page.tsx` | `packages/web/src/features/diagnostics/index.test.tsx` |
| DIAG-002 | diagnostics get/recheck | Implemented | `diagnostics.get`、`diagnostics.recheck` | `packages/server/src/__tests__/diagnostics-commands.test.ts` |
| DIAG-003 | runtime dependency status | Implemented | `systemDeps.runtimeStatus` | `packages/server/src/__tests__/system-deps/runtime-status.test.ts` |
| DIAG-004 | 依赖安装 get/start/cancel/input | Implemented | `systemDeps.install.*`、`use-system-dependency-installer.ts` | `packages/server/src/__tests__/system-deps/commands.test.ts` |
| DIAG-005 | 依赖安装面板 | Implemented | `components/system-dependency-install-panel.tsx` | 手工验收：缺失依赖时显示安装流程 |
| DIAG-006 | 交互提示检测 | Internal | `packages/server/src/system-deps/interaction-detector.ts` | `packages/server/src/__tests__/system-deps/interaction-detector.test.ts` |

## 4. 模块级验收线索

- 诊断页能展示当前环境状态。
- 点击 recheck 后应刷新结果。
- 依赖安装过程应支持取消和必要输入。

## 5. 未确认项

- 不同系统平台的依赖安装命令需按环境单独验收。
