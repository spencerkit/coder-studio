# 数据库兼容性清理与 Schema 基线收敛 · 设计文档

> **版本：** 1.0
> **日期：** 2026-05-05
> **状态：** Draft（等待评审）
> **关联文档：**
> `packages/server/src/storage/db.ts`
> `packages/server/src/storage/migrations/*.sql`
> `packages/server/src/storage/db.test.ts`
> `packages/server/src/__tests__/db.test.ts`
> **作者：** 技术共同设计 — 用户 + Codex

---

## 0. 文档说明

### 0.1 目的

清理当前项目中仅用于“历史数据库升级兼容”的冗余逻辑，把服务端数据库初始化流程收敛为“直接创建当前最新 schema”，不再承担从旧版本本地库逐步升级到新版本的责任。

### 0.2 背景

当前服务端存储层采用“初始 schema + 多段增量 migration + `_migrations` 跟踪表”的模式：

- `openDatabase()` 在启动时调用 `runMigrations()`
- `runMigrations()` 会扫描 `packages/server/src/storage/migrations/*.sql`
- 已存在 8 段 migration，其中多段只服务于历史版本升级

在项目实际上尚未正式上线、无需兼容外部真实用户旧库的前提下，这种设计带来了额外复杂度：

1. 初始化路径同时承担“新建数据库”和“升级旧数据库”两种职责
2. schema 定义被拆散在多段 SQL 中，阅读和维护成本偏高
3. 测试中混入了大量历史升级路径断言，掩盖当前真实业务结构
4. 部分测试 fixture 仍在按旧列结构写数据，增加后续演进摩擦

### 0.3 设计目标

- 收敛为单一“当前最终 schema”基线
- 删除仅服务历史升级的迁移链与测试
- 保留当前业务真正依赖的表、列、索引与仓储逻辑
- 保持新库初始化、内存库测试和 E2E seed 的行为一致
- 对旧本地库采用明确失败策略，而不是继续隐式升级

### 0.4 非目标

- **不**删除当前仍在被业务代码使用的表，例如 `auth_login_blocks`、`auth_login_failures`、`supervisors`
- **不**重构仓储层 API 或调整业务数据模型
- **不**修改与数据库兼容性无关的 websocket、provider、frontend 行为
- **不**保留“老版本本地库自动迁移到新版本”的能力

---

## 1. 现状分析

### 1.1 数据库入口

当前数据库入口位于 `packages/server/src/storage/db.ts`：

- `openDatabase(dbPath)` 打开 SQLite 并执行 WAL / foreign_keys / integrity_check
- `runMigrations(db)` 动态扫描 migration 目录并维护 `_migrations`

这意味着任何数据库启动都必须携带 migration 机制，即便是创建全新数据库。

### 1.2 迁移链中的兼容性负担

当前 migration 文件分为两类：

**当前业务结构所需：**

- `003_supervisors.sql`
- `005_auth_sessions.sql`
- `007_auth_login_blocks.sql`
- `008_auth_login_failures.sql`

**主要用于历史升级兼容：**

- `001_init.sql` 中仍包含旧列 `sessions.resume_id` 与旧表 `hook_registrations`
- `002_transcript_path.sql` 给旧 schema 增加 `transcript_path`
- `004_session_title.sql` 给旧 schema 增加 `title`
- `006_drop_legacy_hook_session_columns.sql` 再删除 `resume_id` / `transcript_path` 并删除 `hook_registrations`
- `008_auth_login_failures.sql` 中的 backfill 段负责把旧 `auth_login_blocks` 数据反推为 `auth_login_failures`

这些兼容逻辑本身不再服务当前产品能力，只服务“旧库如何升级过来”。

### 1.3 测试中的兼容负担

兼容路径的主要测试负担位于：

- `packages/server/src/storage/db.test.ts`
- `packages/server/src/__tests__/db.test.ts`

其中包括：

- migration 顺序发现
- `_migrations` 幂等
- pre-006 旧库升级
- `auth_login_blocks -> auth_login_failures` backfill

此外，`e2e/fixtures/seed-hydrate-refresh-db.ts` 仍使用旧 `sessions` 列表写入 `resume_id` 与 `transcript_path`，与当前最终 schema 概念不一致。

---

## 2. 方案比较

### 2.1 方案 A：保留 migration 机制，仅删除明显废弃列和测试

核心思路：

- 继续保留 `_migrations` 和动态发现
- 尽量压缩历史 migration 文件
- 删除最显眼的 legacy 测试和旧 seed

优点：

- 改动小
- 启动流程基本不变

缺点：

- 没有真正去掉“兼容旧库升级”的整体设计负担
- schema 仍然分散
- 后续新增字段时仍会继续沿用增量迁移思路

### 2.2 方案 B：保留一个版本化 migration 机制，但压平成新基线

核心思路：

- 用新的基线文件替换当前多段链路
- 保留 `_migrations` 与 `runMigrations()`
- 启动时仍然通过 migration 系统创建 schema

优点：

- 保留未来显式 schema 演进工具
- 比当前链路简单

缺点：

- 对当前项目阶段仍然偏重
- 新库初始化仍背着 migration 框架
- 仍然保留“未来也许要升级旧库”的架构暗示

### 2.3 方案 C：移除增量 migration 链，直接以最终 schema 初始化（推荐）

核心思路：

- 用一个最新 schema 快照直接创建数据库
- 删除 `_migrations` 跟踪和动态 migration 扫描
- 旧库不再升级，启动时显式报错并要求清理本地数据库

优点：

- 与项目现阶段最匹配，复杂度最低
- schema 来源唯一，阅读和维护成本最低
- 测试可以聚焦“当前结构是否正确”
- 能彻底删掉历史兼容链

缺点：

- 现有开发者本地旧数据库需要手动删除
- 后续若项目真正上线，再重新引入版本迁移机制时需要重新设计

### 2.4 最终选择

采用 **方案 C**。

原因：

- 项目未正式上线，不需要为未知历史库承担长期兼容成本
- 当前痛点来自“旧库升级”设计压过了“当前 schema 直接可读”的需求
- 本次目标是清理冗余，而不是保守保留未来可能用不到的抽象

---

## 3. 最终设计

### 3.1 目标 schema 形态

数据库初始化后应直接得到当前最终结构，而不是先创建旧表再逐段升级。

最终应保留的核心对象包括：

- `workspaces`
- `terminals`
- `sessions`
- `provider_configs`
- `user_settings`
- `auth_sessions`
- `supervisors`
- `supervisor_cycles`
- `auth_login_blocks`
- `auth_login_failures`

`sessions` 最终列结构应满足当前仓储和业务代码需求：

- 保留：`id`、`workspace_id`、`terminal_id`、`provider_id`、`capability`、`state`、`started_at`、`ended_at`、`last_active_at`、`completion_percent`、`error_reason`、`archived`、`title`
- 不再保留：`resume_id`、`transcript_path`

`hook_registrations` 不再存在于任何初始化 schema 中。

### 3.2 数据库初始化策略

`openDatabase()` 仍保留以下职责：

- 打开 SQLite
- 设置 `PRAGMA journal_mode = WAL`
- 设置 `PRAGMA foreign_keys = ON`
- 执行 `PRAGMA integrity_check`

但初始化职责收敛为：

- 直接创建当前 schema
- 不再扫描 migration 目录
- 不再维护 `_migrations`

推荐做法：

- 保留 `packages/server/src/storage/db.ts` 作为入口
- 以单文件 schema 快照替代多段 migration 扫描
- 初始化逻辑使用 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`

### 3.3 旧库处理策略

既然不再支持历史升级，就不能静默接受旧库。

启动时需要对关键结构进行一致性校验，发现旧结构时直接失败，并给出明确错误信息。最小要求是能识别以下情况：

- `sessions` 仍包含 `resume_id` 或 `transcript_path`
- 存在 `hook_registrations`
- 缺少当前必须存在的表或索引

错误信息应明确指向处理动作，例如：

- 当前数据库来自旧版本结构
- 本版本不再支持自动迁移
- 请删除本地数据库文件后重新启动

默认数据库路径来源于 `packages/server/src/config.ts`，因此报错文案中可以包含实际 `dbPath`。

### 3.4 测试策略

测试从“迁移链正确”改为“当前 schema 正确”。

应保留的测试重点：

- 打开数据库后 PRAGMA 设置正确
- 当前 required tables / indexes 创建正确
- 重复打开文件库不会破坏已有结构
- 外键与级联删除仍正常
- 当前 repo 能在新 schema 上读写

应删除或重写的测试：

- `_migrations` 表存在性测试
- migration 顺序/idempotence 测试
- pre-006 旧库升级测试
- `auth_login_blocks -> auth_login_failures` 历史 backfill 测试

### 3.5 E2E / Fixture 策略

所有 seed 文件必须仅按当前 schema 写数据。

特别是：

- `e2e/fixtures/seed-hydrate-refresh-db.ts` 不再写 `resume_id`
- 不再写 `transcript_path`
- 仅保留当前业务真正会读取的列

这样测试构造的数据模型才会与运行时模型一致。

---

## 4. 影响范围

### 4.1 需要修改的代码

- `packages/server/src/storage/db.ts`
- `packages/server/src/storage/migrations/*.sql` 或替代后的 schema 文件
- `packages/server/src/storage/db.test.ts`
- `packages/server/src/__tests__/db.test.ts`
- `e2e/fixtures/seed-hydrate-refresh-db.ts`

### 4.2 需要保留但要验证的代码

- `packages/server/src/storage/repositories/session-repo.ts`
- `packages/server/src/storage/repositories/auth-login-block-repo.ts`
- `packages/server/src/storage/repositories/supervisor-repo.ts`
- `packages/server/src/storage/repositories/supervisor-cycle-repo.ts`

这些仓储本身不一定需要重写，但必须在新基线 schema 下重新验证。

### 4.3 明确不在本次范围内

- `auth_login_blocks` / `auth_login_failures` 表的业务语义调整
- 登录风控策略调整
- provider 配置存储模型调整
- supervisor 业务逻辑调整

---

## 5. 风险与对策

### 5.1 本地旧数据库失效

风险：

- 开发者已有的本地数据库可能仍是旧结构

对策：

- 启动时 fail fast
- 错误信息中明确指出数据库文件路径与删除动作
- 在文档或变更说明中提示这是一次有意的 schema reset

### 5.2 初始化快照与仓储字段不一致

风险：

- 压平 schema 时漏掉当前业务真实依赖的列或索引

对策：

- 以当前仓储 SQL 和测试构造为基准反推最终 schema
- 在实现阶段补齐“表结构存在性”断言

### 5.3 旧 fixture 漏改

风险：

- E2E 或单测仍按旧列名构造数据，导致后续测试噪音

对策：

- 在实现阶段全局搜索 `resume_id`、`transcript_path`、`hook_registrations`
- 把残留旧写法视为实现未完成

---

## 6. 验收标准

本次清理完成后，应满足：

1. 新建数据库不再依赖 `_migrations`
2. 代码库中不再保留为历史升级服务的 migration 链
3. `sessions` 当前 schema 不再包含 `resume_id`、`transcript_path`
4. `hook_registrations` 不再出现在初始化 schema、测试或 fixture 中
5. 针对旧库升级的测试全部删除或改写
6. 现有业务仓储与关键集成测试在新 schema 上仍通过
7. 遇到旧本地库时，服务端给出明确可操作的失败信息

---

## 7. 实施建议

建议按以下顺序实施：

1. 先定义单一最终 schema 快照
2. 再重写初始化逻辑并加入旧库检测
3. 然后清理单测与集成测试
4. 最后修正 E2E seed 和残留旧列引用

该顺序可以优先锁定结构真相，减少“边改边猜最终 schema”的风险。
