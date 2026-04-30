# Provider CLI 自动安装与会话启动前检查 · 设计文档

> **版本：** 1.0
> **日期：** 2026-04-30
> **状态：** Draft（等待评审）
> **关联文档：**
> `docs/PRD.zh-CN.md`
> `docs/PRD.md`
> **作者：** 技术共同设计 — Spencer + Codex

---

## 0. 文档说明

### 0.1 目的

为 `Claude` / `Codex` 会话入口补齐完整的“启动前检查 -> 自动安装 -> 失败原因回传 -> 手动安装引导”链路，避免当前缺命令时直接在 PTY `spawn` 阶段失败，且没有明确引导。

### 0.2 背景

当前系统中：

- provider 定义已经声明了 `requiredCommands`
- `DraftLauncher` 是创建 `Claude` / `Codex` 会话的统一入口
- `session.create` 目前不会在启动前检查 provider CLI 是否存在
- 缺命令时更可能在 `node-pty spawn` 阶段报通用错误

这带来几个明显问题：

1. 用户在创建会话前无法知道 `claude` / `codex` 是否可用
2. 首页 launcher 与会话内 launcher 都缺少安装引导
3. 即使明确是“命令不存在”，也没有结构化错误和手动安装说明
4. 若 provider 安装依赖本身也缺失，例如 `codex` 通过 `npm` 安装但机器没有 `npm`，当前系统无法继续处理，也无法解释失败原因

### 0.3 设计目标

- 在两个 launcher 入口统一展示 provider 运行状态
- 在 `session.create` 前做 provider CLI 可用性校验
- 支持“安装并启动”交互：用户点击一次即可自动安装并在成功后继续创建会话
- 安装逻辑不是简单裸跑命令，而是基于结构化安装计划执行
- 自动安装失败时，返回明确的失败步骤、失败原因、命令摘要和手动安装引导
- Windows 使用 `where` 检测命令，类 Unix 使用 `which`
- 前端文案走 i18n，不在服务端拼接中英文安装提示

### 0.4 非目标

- **不**在本设计中支持任意第三方 provider 的无限扩展安装生态
- **不**自动处理所有 Linux 发行版的前置依赖安装
- **不**隐式提权或绕过系统权限策略
- **不**在本阶段实现完整终端式实时安装输出面板
- **不**替代官方安装文档；官方文档仍然是失败时的重要兜底路径

---

## 1. 方案比较

### 1.1 方案 A：仅在点击创建时校验

核心思路：

- 用户点击 `Claude` / `Codex`
- `session.create` 失败后再提示缺命令

优点：

- 改动最小

缺点：

- 提示时机过晚
- 两个 launcher 在未安装时仍然表现为“可用”
- 没有自动安装和失败恢复链路

### 1.2 方案 B：前端预检查，不做服务端兜底

核心思路：

- `DraftLauncher` 挂载时检查 provider CLI 可用性
- 前端直接根据结果渲染按钮状态

优点：

- 用户体验明显更好

缺点：

- 无法防止状态过期
- 无法阻止直接调用 `session.create` 进入 PTY 通用失败
- 不能承担“真实状态源”和安装执行责任

### 1.3 方案 C：前端预检查 + 服务端兜底 + 结构化自动安装（推荐）

核心思路：

- `DraftLauncher` 加载时拉取 provider 运行状态
- 用户可直接看到“可启动 / 可自动安装 / 仅支持手动安装”
- 点击安装后由服务端生成安装 plan 并按步骤执行
- `session.create` 保留最终兜底校验

优点：

- 兼顾体验与正确性
- 明确区分“provider 未安装”“安装前置缺失”“自动安装失败”“仅支持手动安装”
- 失败时可以返回结构化原因与后续引导

缺点：

- 比简单校验多出一层安装任务管理与平台策略定义

### 1.4 最终选择

采用 **方案 C**。

原因：

- 用户需求不是单纯“未安装时提示一下”，而是“能自动装就自动装，失败要解释清楚，并引导手动安装”
- 只有把运行时检查、安装计划、执行结果和手动指引统一起来，才能稳定覆盖首页与会话内两个入口

---

## 2. 最终设计

### 2.1 整体链路

系统行为调整为以下流程：

1. `DraftLauncher` 挂载时调用新的 `provider.runtimeStatus`
2. 服务端返回每个 provider 的运行状态、缺失命令、缺失前置、自动安装可行性、手动安装指引 key 与文档地址
3. 前端据此渲染 launcher 卡片状态
4. 用户点击 `安装并启动` 后调用 `provider.install.start`
5. 服务端选择安装策略，生成安装 plan，并异步执行
6. 前端根据安装任务状态更新进度
7. 安装成功后前端重新校验 provider 状态，并自动继续 `session.create`
8. 任一步失败时，前端展示失败原因、手动步骤和文档地址
9. `session.create` 继续保留最终兜底：如果 provider CLI 仍缺失，则拒绝启动并返回结构化错误

### 2.2 Provider 元数据扩展

现有 provider 定义仅有 `requiredCommands`，不足以支撑自动安装。

建议为 provider 定义补充安装描述信息，概念上包含：

- `requiredCommands`
- `installPrerequisites`
- `installStrategies`
- `manualGuideKey`
- `docUrl`

其中：

- `requiredCommands` 决定 provider 是否可运行
- `installPrerequisites` 决定安装策略对哪些工具有依赖，例如 `npm`
- `installStrategies` 描述按平台拆分的自动安装路径
- `manualGuideKey` 与 `docUrl` 用于失败或不支持自动安装时的前端展示

### 2.3 运行状态查询

新增服务端命令：`provider.runtimeStatus`

用途：

- 为 launcher 提供统一状态源
- 为安装前判断“当前是否已可直接启动”
- 为安装完成后的自动复检提供基础能力

返回结构建议为：

```ts
{
  providers: {
    claude: {
      available: boolean,
      missingCommands: string[],
      missingPrerequisites: string[],
      autoInstallSupported: boolean,
      installReadiness: 'ready' | 'missing_prerequisite' | 'unsupported_platform',
      manualGuideKey: string,
      docUrl: string | null,
    },
    codex: {
      available: boolean,
      missingCommands: string[],
      missingPrerequisites: string[],
      autoInstallSupported: boolean,
      installReadiness: 'ready' | 'missing_prerequisite' | 'unsupported_platform',
      manualGuideKey: string,
      docUrl: string | null,
    },
  }
}
```

实现要求：

- Windows 下用 `where`
- `darwin` / `linux` 下用 `which`
- 运行时缺失与安装前置缺失必须分开返回

### 2.4 会话创建兜底

`session.create` 在进入 `SessionManager.create` 前，必须根据 provider 的 `requiredCommands` 再做一次校验。

若缺命令，返回结构化错误：

```ts
{
  code: 'provider_cli_missing',
  message: 'Provider CLI is not installed',
  details: {
    providerId: 'codex',
    missingCommands: ['codex']
  }
}
```

这样可以避免缺命令时落到 PTY 的通用 `spawn` 异常，提高错误可解释性。

---

## 3. 安装计划模型

### 3.1 为什么需要安装计划

安装逻辑不能是“一把梭脚本”，原因是：

- provider CLI 缺失和安装前置缺失不是同一个问题
- 平台差异明显，例如 Windows、macOS、Linux 的包管理器不同
- 某些前置可以自动安装，某些平台上则只能给手动步骤
- 用户要求失败时必须明确说明失败原因，而不是只给一句“安装失败”

因此，服务端需要先生成结构化 install plan，再逐步执行。

### 3.2 安装策略

每个 provider 的 `installStrategies` 按平台声明候选策略。

每个策略概念上包含：

- `id`
- `platforms`
- `requires`
- `steps`
- `verifyCommands`
- `fallbackGuideKey`

说明：

- `requires` 用于描述执行此策略所依赖的工具，例如 `npm`、`winget`、`brew`
- `steps` 是顺序执行的安装步骤
- `verifyCommands` 用于安装后确认 provider 命令已经可用
- `fallbackGuideKey` 用于自动安装失败后的手动兜底文案

### 3.3 安装计划

`provider.install.start` 在真正执行前，先为当前 provider 与平台生成 install plan。

建议结构：

```ts
{
  providerId: 'codex',
  strategyId: 'npm-global',
  canAutoInstall: true,
  missingRuntimeCommands: ['codex'],
  missingPrerequisites: ['npm'],
  steps: [
    {
      id: 'install-prerequisite-npm',
      titleKey: 'provider.codex.install.step.install_npm',
      kind: 'install',
      command: 'winget',
      args: ['install', 'OpenJS.NodeJS.LTS'],
      onFailure: 'stop',
    },
    {
      id: 'install-provider-codex',
      titleKey: 'provider.codex.install.step.install_codex',
      kind: 'install',
      command: 'npm',
      args: ['install', '-g', '<provider-package-from-strategy>'],
      onFailure: 'stop',
    },
    {
      id: 'verify-provider-codex',
      titleKey: 'provider.codex.install.step.verify_codex',
      kind: 'verify',
      command: 'codex',
      args: ['--version'],
      onFailure: 'stop',
    }
  ]
}
```

### 3.4 前置缺失的处理原则

当 provider CLI 缺失，且推荐安装方式的前置依赖也缺失时，系统应按以下顺序处理：

1. 如果当前平台存在受支持的前置自动安装策略，则先安装前置
2. 前置成功后继续安装 provider
3. 若前置当前无法自动安装，则不继续执行 provider 安装
4. 返回明确失败原因，并附带手动安装步骤与文档地址

这意味着：

- `codex` 缺失且 `npm` 缺失时，不应直接运行 `npm install -g ...`
- `codex` 缺失且 `npm` 缺失时，不应直接运行 provider 安装命令，而应先处理 `npm` 缺失
- 系统必须先解释并处理 `npm` 不存在这件事

---

## 4. 安装任务与执行

### 4.1 服务端命令

建议新增以下命令：

1. `provider.runtimeStatus`
2. `provider.install.start`
3. `provider.install.get`

用途：

- `provider.runtimeStatus`：页面加载、安装前检测、安装后复检
- `provider.install.start`：创建安装任务并开始执行
- `provider.install.get`：刷新页面或断线恢复后读取任务状态

### 4.2 为什么使用异步安装任务

安装过程可能持续几十秒甚至更久，不适合做成一个同步 command 直接等待。

因此采用异步 job 模型：

- `provider.install.start` 返回 `jobId`
- 服务端后台顺序执行 install plan
- 前端通过事件或后续查询获取进度

### 4.3 安装任务状态

建议任务状态包含：

- `queued`
- `running`
- `succeeded`
- `failed`

任务快照建议包含：

- `jobId`
- `providerId`
- `strategyId`
- `status`
- `currentStepId`
- `steps`
- `failure`

### 4.4 步骤执行记录

每个 step 执行后都要落地记录：

- `stepId`
- `titleKey`
- `kind`
- `command`
- `args`
- `status`
- `startedAt`
- `finishedAt`
- `exitCode`
- `stdoutExcerpt`
- `stderrExcerpt`

这样前端在失败时可以直接展示“失败在哪一步、跑了什么命令、命令输出摘要是什么”。

### 4.5 并发约束

同一 provider 同时只允许一个安装任务处于 `queued` 或 `running`。

若用户重复点击：

- 返回当前活跃任务的 `jobId`
- 前端直接复用现有安装状态，不重新创建第二个任务

---

## 5. 错误分类与失败回传

### 5.1 错误分类

服务端不应只回传原始 stderr，而应先做错误归类。

建议统一分类：

- `missing_prerequisite`
- `unsupported_platform`
- `permission_denied`
- `command_not_found`
- `command_failed`
- `verification_failed`
- `unknown_failure`

### 5.2 失败结构

失败对象建议包含：

```ts
{
  code: 'missing_prerequisite',
  providerId: 'codex',
  failedStepId: 'install-provider-codex',
  message: 'npm command not found',
  command: 'npm',
  args: ['install', '-g', '<provider-package-from-strategy>'],
  exitCode: 127,
  stdoutExcerpt: '',
  stderrExcerpt: 'npm: command not found',
  missingCommands: ['npm'],
  manualGuideKey: 'provider.codex.manual_install',
  docUrl: 'provider-specific-doc-url'
}
```

### 5.3 失败时的系统行为

一旦任一步失败：

1. 当前任务标记为 `failed`
2. 返回失败步骤与失败类型
3. 返回对应的手动安装 guide key
4. 返回官方文档地址
5. 不继续执行后续安装步骤

这样可以满足“失败后要解释原因，并引导用户手动安装”的要求。

---

## 6. 前端交互设计

### 6.1 适用入口

首页 launcher 与会话内 launcher 当前都复用同一个 `DraftLauncher`。

因此本设计在一个组件内接入即可同时覆盖两个入口。

### 6.2 Launcher 状态

每个 provider 卡片需要支持至少三种主状态：

1. **可直接运行**
   - 主按钮：`启动会话`

2. **不可运行但可自动安装**
   - 主按钮：`安装并启动`

3. **不可运行且当前仅支持手动安装**
   - 主按钮：`查看安装步骤`
   - 同时展示简要手动提示

### 6.3 安装中状态

用户触发安装后，provider 卡片进入安装态：

- 显示当前步骤
- 显示安装进度文案
- 禁用重复点击
- 若已有任务正在运行，直接复用该任务状态

### 6.4 安装成功

安装成功后：

1. 前端重新调用 `provider.runtimeStatus`
2. 确认 provider CLI 已可运行
3. 自动调用 `session.create`

用户体验应是“一次点击安装并启动，成功后直接进入会话”。

### 6.5 安装失败

失败信息的主承载体应是 launcher 卡片内联区域，而不是只靠 toast。

卡片内应展示：

- 失败步骤
- 失败原因
- 手动安装步骤文案
- 打开文档入口
- `重试安装`

toast 可以作为辅助提醒，但不能替代主信息区域。

### 6.6 i18n 约束

前端负责展示文案，服务端只返回结构化状态和 key。

需要新增的前端文案至少包括：

- provider 可运行状态文案
- 安装中步骤文案
- 自动安装失败文案
- 手动安装步骤文案
- 打开官方文档文案

---

## 7. 平台策略与边界

### 7.1 命令探测

- Windows：使用 `where`
- macOS / Linux：使用 `which`

命令探测应被抽成统一 helper，避免重复散落。

### 7.2 平台策略优先级

建议优先级：

1. 按 provider 选择安装定义
2. 再按 `process.platform` 选择当前平台的自动安装策略
3. Windows 优先选择 `winget` 路径
4. macOS 优先选择 `brew` 路径
5. Linux 仅在明确支持的前置安装器条件下开放自动安装

### 7.3 Linux 边界

Linux 发行版差异较大。

MVP 阶段：

- 若 provider 安装前置已存在，则允许自动安装 provider
- 若前置不存在，且当前发行版/包管理器没有明确支持策略，则直接返回不支持自动安装，并引导用户手动安装

### 7.4 权限边界

若自动安装需要管理员权限：

- 不做隐式提权
- 直接归类为 `permission_denied`
- 明确告诉用户需要手动执行安装步骤

### 7.5 PATH 可见性边界

安装命令成功不代表当前 Coder Studio 进程立刻能在 `PATH` 中解析到新命令。

因此安装后必须进行二次验证。

若安装命令成功但验证失败：

- 归类为 `verification_failed`
- 引导用户重启 Coder Studio 或重新打开终端

---

## 8. MVP 范围

### 8.1 本阶段必须完成

- 抽取统一命令探测 helper，支持 `where` / `which`
- 新增 `provider.runtimeStatus`
- 新增 `provider.install.start`
- 新增 `provider.install.get`
- 为 `claude` / `codex` provider 定义补充安装元数据
- `DraftLauncher` 支持“启动会话 / 安装并启动 / 查看安装步骤”三种主状态
- 安装任务支持结构化步骤记录和失败对象回传
- `session.create` 增加 provider CLI 缺失的最终兜底校验
- 前端补全 i18n 文案

### 8.2 可后续迭代

- Linux 发行版级别的更细致自动安装支持
- 安装输出的更丰富实时日志展示
- 设置页中的独立 provider 安装入口
- 安装完成后的 shell 环境刷新优化

---

## 9. 测试设计

### 9.1 服务端

需要覆盖：

- `where` / `which` 平台分支
- `provider.runtimeStatus` 的运行时缺失与前置缺失返回
- `session.create` 在 provider CLI 缺失时返回 `provider_cli_missing`
- 安装策略选择
- 安装任务步骤执行成功路径
- 前置安装失败路径
- provider 安装失败路径
- 安装后验证失败路径
- 并发安装任务复用路径

### 9.2 前端

需要覆盖：

- launcher 在 provider 可运行时渲染 `启动会话`
- launcher 在可自动安装时渲染 `安装并启动`
- launcher 在仅支持手动安装时渲染手动引导
- 安装成功后自动进入 `session.create`
- 安装失败时展示失败原因、手动步骤和文档入口
- 两个 launcher 入口都受同一 `DraftLauncher` 状态驱动

---

## 10. 风险与取舍

### 10.1 风险

- 自动安装链路跨平台差异大，策略定义不完整会导致大量边缘失败
- PATH 刷新问题会让“安装成功但当前进程不可见”成为一个真实场景
- 如果错误归类做得不够稳，前端仍可能只能显示泛化失败

### 10.2 取舍

本设计优先保证：

- 启动前能明确知道 provider 是否可用
- 能自动安装时尽量自动安装
- 自动安装失败时提供清晰解释和手动兜底

而不是追求：

- 在所有平台、所有发行版、所有权限模型下都自动搞定安装

---

## 11. 最终结论

本设计将 `Claude` / `Codex` 会话入口从“点了再试”升级为“先检查、能装就装、失败能解释、最后再启动”的完整链路。

核心原则是：

- 运行状态与安装能力都由服务端负责判定
- 前端负责把状态、进度、失败原因和手动引导清晰展示出来
- `session.create` 必须保留最终兜底，不能再把 provider 缺失问题留给 PTY 通用错误

在此基础上，首页 launcher 与会话内 launcher 都将获得一致的用户体验，并且在 `npm`、`winget`、`brew` 等安装前置缺失时，也能给出可执行的下一步，而不是直接把失败留给用户自行猜测。
