# Updates

> 第一轮模块索引。本文只记录代码可见的功能点、状态、代码入口和验收入口。

## 1. 模块范围

覆盖：
- 更新状态获取、检查、准备安装、开始安装。
- Footer update rail。

不覆盖：
- 发布说明文案。

## 2. 用户入口

| 入口 | 端 | 说明 |
| --- | --- | --- |
| Footer update rail | Desktop | 展示更新状态和操作入口。 |
| Settings / About | Both | 可能展示版本或更新状态。 |

## 3. 功能点清单

| ID | 功能点 | 状态 | 代码入口 | 验收入口 |
| --- | --- | --- | --- | --- |
| UPDATE-001 | 获取更新状态 | Implemented | `updates.getState`、`packages/web/src/features/updates/atoms.ts` | `packages/server/src/commands/updates.test.ts` |
| UPDATE-002 | 检查更新 | Implemented | `updates.check` | `packages/server/src/commands/updates.test.ts` |
| UPDATE-003 | 准备安装 | Implemented | `updates.prepareInstall` | `packages/server/src/commands/updates.test.ts` |
| UPDATE-004 | 开始安装 | Implemented | `updates.startInstall` | `packages/server/src/commands/updates.test.ts` |
| UPDATE-005 | Footer update rail | Implemented | `footer-update-rail.tsx` | `footer-update-rail.test.tsx` |
| UPDATE-006 | update state repo | Internal | `packages/server/src/update`、`storage` | `packages/server/src/__tests__/update-state-repo.test.ts` |

## 4. 模块级验收线索

- 检查更新后应更新状态。
- 有可安装更新时 footer rail 应展示操作。
- 安装流程失败时应保留错误信息。

## 5. 未确认项

- 实际安装命令的跨平台验收需单独环境验证。
