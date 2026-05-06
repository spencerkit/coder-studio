# Biome Lint 落稳与自动化接入 · 设计文档

> **版本：** 1.0
> **日期：** 2026-05-05
> **状态：** Draft（等待评审）
> **关联文档：**
> `biome.jsonc`
> `package.json`
> `README.md`
> `.github/workflows/*`
> `.husky/*`
> **作者：** 技术共同设计 — 用户 + Codex

---

## 0. 文档说明

### 0.1 目的

为当前 monorepo 建立一套可长期维护的代码质量基线，分阶段完成以下目标：

- 先把现有 `Biome` 工具链落稳
- 再把质量检查接入 CI 和 Git hooks
- 最后清理现有 warning，并逐步提升规则严格度

本次设计强调“先稳定入口，再治理历史债务”，避免在工具治理阶段引入过大的代码改动风险。

### 0.2 背景

当前仓库已经存在 `Biome` 基础接入：

- 根目录存在 `biome.jsonc`
- 根 `package.json` 已定义 `lint` 和 `format`
- 依赖中已有 `@biomejs/biome`

但当前状态仍不适合作为稳定质量基线：

1. `biome.jsonc` 中的 schema 版本与当前 CLI 版本不一致
2. `pnpm lint` 执行时会混入无关噪音，例如 broken symlink 提示
3. 仓库没有已确认的 CI / Git hooks 质量入口
4. 代码库存在较多历史 warning，当前不适合直接切到阻断模式

### 0.3 设计目标

- 明确 `Biome` 是当前仓库唯一的 lint / format 工具
- 让根级质量命令具备稳定、可预测的行为
- 为后续 `changed files`、`staged files` 自动化检查预留配置基础
- 让 CI 与 Git hooks 尽快接入，但不过早阻断历史 warning
- 为后续 warning 清理和规则收紧提供可执行的阶段化路线

### 0.4 非目标

- **不**在本次设计中重新引入 ESLint、Prettier、Stylelint 多工具并存方案
- **不**在第一阶段大规模清理现有 warning
- **不**一次性引入 import layering、架构边界校验等更重的静态规则
- **不**在第一阶段把 warning 全部提升为 error
- **不**在第一阶段让 CI 或 hooks 因历史 warning 大面积阻断开发

---

## 1. 现状分析

### 1.1 已有质量工具

当前仓库根目录已有以下工具接入：

- `biome.jsonc`
- `package.json` 中的 `lint`：`biome lint .`
- `package.json` 中的 `format`：`biome format --write .`

说明项目并非“没有 lint 工具”，而是“已有 Biome，但尚未落稳并接入自动化”。

### 1.2 当前主要问题

已确认的主要问题包括：

1. **配置版本不一致**
   - 配置 schema 指向 `2.4.12`
   - 当前 CLI 实际为 `2.4.14`

2. **命令输出含噪音**
   - `pnpm lint` 会报告 schema mismatch
   - `pnpm lint` 会出现 broken symlink 相关提示

3. **命令职责不完整**
   - 目前只有 `lint` 和 `format`
   - 缺少统一聚合入口，例如 `check`
   - 缺少显式 `lint:fix`

4. **自动化尚未接入**
   - 未看到现成的 CI workflow
   - 未看到现成的 Git hooks 配置

5. **历史 warning 存量较高**
   - 现阶段直接启用阻断型 CI / hooks 会影响开发流畅性

### 1.3 warning 结构概览

当前已观测到的 warning 主要分两类：

- `lint/correctness/noUnusedVariables`
- `lint/suspicious/noExplicitAny`

这两类问题风险不同：

- `unused` 多数是低风险治理项，适合优先清理
- `any` 需要按测试 mock、业务代码、动态边界区分处理，不能机械替换

---

## 2. 方案比较

### 2.1 方案 A：直接全面修 warning，再补自动化

核心思路：

- 先清全仓 warning
- 再补 CI / hooks
- 最后统一收紧规则

优点：

- 如果一次做完，最终状态最整齐

缺点：

- 初始改动面过大
- 风险集中在单次改动中
- 工具治理会演变成大规模代码清理

### 2.2 方案 B：Biome、CI、hooks 一次性接入，并立即阻断

核心思路：

- 同时完善 `Biome`
- 直接启用阻断型 CI / pre-commit
- 逼迫后续快速清 warning

优点：

- 收口速度快
- 团队约束建立得早

缺点：

- 当前历史 warning 会立刻转化为开发阻力
- hooks / CI 容易在接入当日就影响日常提交
- 不符合“先落稳再修”的阶段目标

### 2.3 方案 C：分三阶段推进（推荐）

核心思路：

- Phase 1：先完善 `Biome` baseline 和根命令
- Phase 2：再接入 CI / Git hooks，但先避免历史 warning 直接阻断
- Phase 3：最后分批清 warning，并逐步提升严格度

优点：

- 风险可控
- 质量工具行为和质量债治理解耦
- 最符合当前仓库现状和目标顺序

缺点：

- 从“有工具”到“全阻断全绿”需要更长过渡期

### 2.4 最终选择

采用 **方案 C**。

理由：

- 当前仓库已经有 `Biome` 基础，不需要重新选型
- 当前 warning 存量较高，不适合一步切阻断
- 先落稳工具链，再接自动化，再治理历史告警，是最稳妥的推进顺序

---

## 3. 最终设计

### 3.1 工具原则

本仓库的代码质量工具原则如下：

- `Biome` 作为当前唯一 lint / format 工具
- 质量命令集中定义在仓库根目录
- 各 package 不单独维护自己的 lint 工具配置
- 自动化入口复用根命令，不复制平行逻辑

### 3.2 文件组织策略

本次落地的主要改动范围应集中在根目录：

- `biome.jsonc`
- `package.json`
- `README.md`
- `.github/workflows/quality.yml`
- `.husky/pre-commit`
- 可能新增 `.husky/pre-push`，但非第一优先级

这样可以保证：

- 质量工具入口唯一
- 配置和自动化行为一致
- 避免每个子包各自维护脚本或规则

### 3.3 命令契约

建议定义以下根命令：

- `pnpm lint`
  - 仅执行 lint 诊断
  - 用于开发者查看规则问题

- `pnpm lint:fix`
  - 执行 `biome lint --write .`
  - 只应用 safe fixes

- `pnpm format`
  - 执行 `biome format --write .`
  - 只负责格式化

- `pnpm check`
  - 执行 `biome check .`
  - 作为统一质量入口，供人工自检和 CI 复用

命令职责必须保持单一：

- `lint` 不负责格式化
- `format` 不负责 lint 诊断
- `check` 才是聚合入口

### 3.4 Phase 1：Biome baseline

第一阶段只解决“工具链是否稳定可用”，不解决“是否全绿”。

本阶段应完成：

1. 对齐 `biome.jsonc` schema 版本与当前 CLI 版本
2. 明确 VCS 相关基础配置，为后续 `--changed` 预留基础
3. 收敛文件扫描范围，减少与仓库无关的扫描噪音
4. 补齐根质量脚本：`lint`、`lint:fix`、`format`、`check`
5. 更新开发文档，让贡献者清楚知道命令用途

本阶段不做：

- 不全面修 warning
- 不启用 `--error-on-warnings`
- 不引入新的重型规则集

### 3.5 Phase 2：CI / Git hooks

第二阶段目标是“自动化链路接通”，不是“立刻严格阻断”。

#### CI

建议新增单独的质量 workflow，初始职责为：

- 安装依赖
- 执行统一质量入口
- 在 PR / push 中提供持续反馈

第一版 CI 应优先保证：

- 行为稳定
- 输出清晰
- 不因历史 warning 直接导致团队完全无法合并正常改动

如全仓 `pnpm check` 仍受历史 warning 影响较大，则可采用过渡策略之一：

- 只检查 changed files
- 只对 error 级别失败
- 先保留 workflow 成功但输出诊断信息

具体采用哪一种，以 Phase 1 结束时的实际 warning 状况为准。

#### Git hooks

建议使用 `husky` 接入 Git hooks。

`pre-commit` 建议执行：

- `pnpm exec biome check --write --staged`

理由：

- 只处理 staged 文件，提交体验更可控
- 能同时处理格式化、import sorting 和 safe fixes
- 不需要再额外引入 `lint-staged`

第一轮不建议在 `pre-push` 增加全量仓库检查，避免在 warning 存量较高时破坏开发体验。

### 3.6 Phase 3：warning 治理与规则收紧

第三阶段进入代码治理本身。

推荐顺序：

1. 先清 `noUnusedVariables`
2. 再清 `noExplicitAny`
3. 最后决定是否：
   - 把部分规则从 `warn` 提升为 `error`
   - 让 CI 使用 `--error-on-warnings`
   - 让 hooks 对 warning 失败

治理策略要求分层处理：

- 业务代码优先明确真实类型
- 测试代码优先降低无意义噪音，但不牺牲可读性
- 对边界动态对象避免机械“去 any 化”

---

## 4. 分阶段实施策略

### 4.1 Milestone 1：Biome baseline 完成

完成标准：

- `pnpm lint` 能稳定执行
- `pnpm lint:fix` 能稳定执行
- `pnpm format` 能稳定执行
- `pnpm check` 能稳定执行
- schema mismatch 消失
- 主要输出不再被 symlink / 无关目录噪音污染

允许状态：

- 仍存在历史 warning

### 4.2 Milestone 2：CI / hooks 接通

完成标准：

- PR / push 可运行质量 workflow
- 本地 `pre-commit` 能检查 staged files
- 自动化使用的入口与本地文档一致

允许状态：

- 仍保留部分历史 warning
- 自动化策略可能仍处于“非完全阻断”模式

### 4.3 Milestone 3：warning 清理与收紧完成

完成标准：

- 低风险 warning 明显下降
- `any` 存量开始按模块消化
- CI / hooks 严格度进入下一档

理想终态：

- 仓库 warning 足够少，能够安全切换到更严格的失败策略

---

## 5. 验证策略

### 5.1 Phase 1 验证

验证目标是“命令稳定”，而不是“零 warning”。

至少应验证：

- `pnpm lint`
- `pnpm lint:fix`
- `pnpm format`
- `pnpm check`

期望：

- 命令可执行
- 输出符合命令语义
- 不再出现 schema mismatch

### 5.2 Phase 2 验证

验证目标是“自动化链路接通”。

至少应验证：

- hooks 能在 staged files 上运行 `Biome`
- workflow 能在仓库中运行统一质量入口
- 本地与 CI 入口不发生分叉

### 5.3 Phase 3 验证

验证目标是“warning 存量下降且严格度可提升”。

至少应验证：

- warning 数量变化趋势明确
- 清理后的目录未引入新的质量回退
- 更严格的失败策略不会立刻阻断大量正常开发

---

## 6. 风险与控制

### 6.1 风险：Phase 1 顺手改太多规则

如果第一阶段同时引入大量新规则，工具落稳会演变成代码行为改造。

控制策略：

- 第一阶段只做基线收敛
- 不扩张规则面
- 不升级大量 `warn` 为 `error`

### 6.2 风险：Phase 2 自动化过早阻断

如果 CI / hooks 在历史 warning 未处理前就完全阻断，会直接影响开发效率。

控制策略：

- 第二阶段以“接通反馈”为首要目标
- 阻断策略延后到第三阶段再决定

### 6.3 风险：机械清理 `any`

盲目替换 `any` 很容易引入虚假的类型安全或更差的可读性。

控制策略：

- 区分测试 mock、动态边界和业务代码
- 优先使用更窄的真实类型
- 必要时接受局部过渡方案，但不扩大其使用范围

### 6.4 风险：根命令与自动化入口分叉

如果本地和 CI 分别维护不同命令，后续维护成本会持续上升。

控制策略：

- 文档、CI、hooks 全部复用根命令或同一条 `Biome` 入口

---

## 7. 结论

本次质量治理不应被实现为“一次性清仓式修 warning”，而应分三步推进：

1. 先把 `Biome` baseline 和根命令落稳
2. 再把 CI / Git hooks 接入为稳定反馈链路
3. 最后系统性清理 warning，并逐步提升阻断力度

这样既能尽快建立统一质量入口，又不会让历史债务在同一天变成开发阻塞。
