# Supervisor 递归规划与执行粒度控制设计

> **版本：** 1.0
> **日期：** 2026-06-07
> **状态：** Draft（待评审）
> **作者：** Spencer + Codex

## 1. 背景

当前 Supervisor 已经具备目标记忆、初始 decomposition、进展评估和 guidance 注入能力。现有实现会在目标没有 decomposition 时调用 `mode="decompose"` 生成 `items`，之后每轮通过 `mode="evaluate"` 判断进展、更新 `itemUpdates`、生成 guidance 并注入给 agent。

这个机制可以监督进展，但它默认把 decomposition items 当作可执行粒度。对于大目标，这会导致计划节点过粗。例如“写一部 100 万字小说”可能被拆成 5 个阶段，每个阶段仍然是 20 万字级别。Supervisor 随后会把这种粗节点作为当前执行目标推进，AI 单次任务过大，质量、上下文控制和验收都会变差。

本设计的核心不是“失败后纠偏”，而是：**Supervisor 在下发任务前必须判断当前节点是否适合 AI 执行；不适合时只递归拆当前 active branch，直到形成可执行 leaf。**

## 2. 目标

- 初始计划允许保持高层结构，不要求一开始拆完整棵树。
- Supervisor 只对当前 active branch 递归拆分，未轮到的 sibling 保持粗粒度占位。
- 每个即将下发给 agent 的任务必须通过类型化 `ready_check`。
- 支持 coding、writing、research、design、generic 等任务类型的不同粒度标准。
- UI 可以展示类似思维导图的整体计划树，同时执行逻辑只关注 current leaf path 和 next executable item。
- 使用 `maxDepth` 防止无限递归拆分。
- 达到 `maxDepth` 仍不 ready 时，生成前置准备任务或范围受限任务，而不是继续无限拆树或把大任务硬塞给 agent。
- 保持旧 `items` memory 可读，并提供迁移到树状结构的路径。

## 3. 非目标

- 不一次性实现完整项目管理系统、跨 session 编排或多 agent 分工。
- 不要求初始规划展开整棵深层树。
- 不做完整 plan version diff UI；MVP 只记录 `planRevision`。
- 不把“任务类型粒度标准”做成用户可配置规则引擎；先内置一组默认标准。
- 不改变 provider headless 命令抽象，只扩展 Supervisor evaluator 的 prompt schema 和解析逻辑。

## 4. 现状与差距

当前核心结构：

- `SupervisorTargetMemory.items` 是扁平工作项列表。
- `decompositionGenerated` 表示是否已生成初始 decomposition。
- `activeItemId` 指向当前 item。
- `stalledCount` 只基于是否有 `progressSummary` 或 `itemUpdates` 粗略累计。
- evaluator prompt 明确要求 normal evaluation cycle 不重写 decomposition structure。

这导致三个限制：

1. **没有任务 ready gate**：一个 item 是否适合下发给 AI 执行没有独立判断。
2. **没有递归拆分 active item 的流程**：初始 item 太大时，只能在旧计划内给 guidance。
3. **没有树状表达**：UI 和 memory 无法表达“高层 mind map + 当前 leaf path”的关系。

## 5. 核心设计

采用 **Lazy Recursive Decomposition**：

```text
user objective
  -> generate top-level plan nodes
  -> select active node
  -> ready_check(active node)
      -> too_large: decompose this node only, then check first child
      -> ready: generate executable guidance and inject
      -> too_small: move execution scope upward or merge scope
      -> maxDepth reached and still not ready: create executable preparatory/range-limited task
  -> evaluate leaf completion
  -> mark leaf done
  -> roll up parent status
  -> select next sibling
```

重要约束：

- 初始计划只需要 3-7 个高层节点。
- sibling 不提前深拆。
- 当前 active branch 可以一次递归拆到 ready，只受 `maxDepth` 限制。
- MVP 不引入“一轮最多拆几次”的限制，避免首次执行停在不可执行的中间层。

## 6. Ready Check

`ready_check` 判断的是：**当前节点现在能不能交给 AI 执行，并期待质量稳定、验收清楚。**

建议 evaluator 输出：

```json
{
  "mode": "ready_check",
  "nodeId": "node_1",
  "taskType": "writing",
  "granularity": "too_large",
  "reason": "The node asks for an entire 200k-word volume, which is too broad for one high-quality execution step.",
  "recommendedUnit": "scene_card_or_scene_draft",
  "qualityRisk": "large_scope_quality_loss",
  "missingInputs": ["scene conflict", "character motivation"],
  "confidence": "high"
}
```

`granularity` 含义：

- `too_large`：节点过大，需要继续拆当前节点。
- `ready`：节点适合作为下一次执行任务。
- `too_small`：节点过碎，执行会破坏质量或上下文，应提升到 parent 或合并相邻范围。

任务类型默认标准：

| 类型 | 合适执行粒度示例 | 过大示例 | 过碎示例 |
| --- | --- | --- | --- |
| `writing` | 人物卡、设定卡、章节大纲、场景卡、1500-3000 字场景正文 | 整卷正文、20 万字阶段 | 单句、单段 |
| `coding` | 一个可验证行为、一个失败测试到通过、一个小模块边界内改动 | 多子系统重构、完整平台功能 | 改一个变量名但没有独立价值 |
| `research` | 一个明确问题的资料收集和结论 | 开放式行业研究 | 单个搜索关键词 |
| `design` | 一个组件/流程/模型的具体设计段落 | 整个产品系统重设 | 单个文案词替换 |
| `generic` | 产物和验收都清楚的小步骤 | 无边界大目标 | 无独立产物的小动作 |

## 7. 计划树数据模型

新增树状 plan memory。旧 `items` 保留兼容读取，但新写入以 `planTree` 为主。

```ts
type SupervisorPlanNodeStatus = "pending" | "in_progress" | "done" | "blocked";
type SupervisorTaskType = "coding" | "writing" | "research" | "design" | "generic";
type SupervisorGranularity = "too_large" | "ready" | "too_small";

interface SupervisorPlanNodeReadyCheck {
  granularity: SupervisorGranularity;
  reason: string;
  recommendedUnit?: string;
  qualityRisk?: string;
  missingInputs?: string[];
  confidence?: "low" | "medium" | "high";
  checkedAt: number;
}

interface SupervisorPlanNodeExecution {
  executable: boolean;
  guidance?: string;
  lastInjectedAt?: number;
}

interface SupervisorPlanNode {
  id: string;
  parentId?: string;
  title: string;
  objective: string;
  deliverable: string;
  acceptanceCriteria: string[];
  status: SupervisorPlanNodeStatus;
  taskType: SupervisorTaskType;
  depth: number;
  children: SupervisorPlanNode[];
  readyCheck?: SupervisorPlanNodeReadyCheck;
  execution?: SupervisorPlanNodeExecution;
}

interface SupervisorTargetMemory {
  planTree?: SupervisorPlanNode;
  activeNodeId?: string;
  activeLeafPath?: string[];
  maxDepth: number;
  planRevision: number;
}
```

旧字段兼容：

- 如果 memory 只有 `items`，加载时生成 synthetic root。
- 每个 legacy item 成为 root child。
- `activeItemId` 映射为 `activeNodeId`。
- `decompositionGenerated` 可由 `planTree.children.length > 0` 推导，但 MVP 可以保留字段避免大范围破坏。

## 8. Evaluator 模式

在现有 `decompose` 和 `evaluate` 基础上增加两个模式：

### 8.1 `ready_check`

输入：

- user objective
- current target memory
- active node
- active leaf path
- task type hints
- terminal/headless snapshot
- latest user input

输出：

- `granularity`
- `reason`
- `recommendedUnit`
- `missingInputs`
- `qualityRisk`
- `confidence`

### 8.2 `decompose_child`

只拆当前 active node，不处理 sibling。

输出：

```json
{
  "mode": "decompose_child",
  "parentNodeId": "node_1",
  "children": [
    {
      "id": "node_1_1",
      "title": "Write the scene card",
      "objective": "Define the first scene before drafting prose",
      "deliverable": "A 500-800 word scene card",
      "acceptanceCriteria": ["characters are named", "conflict is explicit", "ending hook is defined"],
      "taskType": "writing",
      "status": "in_progress"
    }
  ],
  "activeNodeId": "node_1_1",
  "progressSummary": "Split the first volume node into executable writing preparation steps."
}
```

### 8.3 `executable_task`

当 `ready_check` 返回 `ready`，或达到 `maxDepth` 仍不 ready 时使用。

它生成下发给 agent 的具体 guidance。达到 `maxDepth` 的 fallback guidance 必须把任务转成前置准备任务或范围受限任务。

示例：

```text
Do not draft the full chapter yet. First create a scene card for scene 1:
- characters
- scene goal
- conflict
- emotional turn
- ending hook
- 500-800 words
```

## 9. Runtime Flow

Manager 层新增 `prepareExecutableNode` 流程：

```text
prepareExecutableNode(supervisor, context, memory)
  ensurePlanTree()
  node = resolveActiveNode()
  loop:
    check = evaluator.ready_check(node)
    saveReadyCheck(node, check)

    if check.granularity == "ready":
      guidance = evaluator.executable_task(node)
      saveExecution(node, guidance)
      return { node, guidance }

    if check.granularity == "too_small":
      node = selectParentOrMergedScope(node)
      continue

    if node.depth < memory.maxDepth:
      children = evaluator.decompose_child(node)
      attachChildren(node, children)
      node = firstActiveChild(children)
      continue

    fallback = evaluator.executable_task(node, { fallback: true, readyCheck: check })
    saveExecution(node, fallback.guidance)
    return { node, guidance: fallback.guidance }
```

执行结束后的现有 `evaluate` 继续负责验收当前 executable leaf：

- 有证据满足 acceptance criteria 时标记 leaf done。
- leaf done 后选择下一个 pending sibling。
- sibling 不存在时，父节点在所有 children done 后 roll up 为 done。
- 如果 parent done，继续向上 roll up。
- 下一个 active node 再进入 `ready_check`。

## 10. UI 展示

UI 分为两块：

### 10.1 Mind Map / Tree View

展示完整计划树：

- 高层节点可保持粗粒度。
- 已拆分的 active branch 展开。
- 未轮到的 sibling 可显示为折叠节点。
- 节点状态包括 pending、in progress、done、blocked。
- 节点可展示 ready check 标签：too large、ready、too small。

### 10.2 Execution Focus Panel

只展示执行所需内容：

- current leaf path，例如 `小说 > 第一卷 > 第一幕 > 第 1 章 > 第 1 场`
- 当前 ready check 结果
- next executable item
- deliverable
- acceptance criteria
- 最近 guidance

这保证用户能看到全局 mind map，但 Supervisor 执行逻辑只关注 current leaf path 和 next executable item。

## 11. 错误与边界

- evaluator 返回非法 JSON：当前 cycle failed，保留旧 plan tree，不覆盖 memory。
- `decompose_child` 返回空 children：标记 supervisor error，提示 decomposition failed。
- `ready_check` 缺少 `granularity`：按 evaluator 输出非法处理。
- `too_small` 无可提升 parent：将当前 node 标记为 ready，并要求 executable guidance 合并必要上下文。
- 达到 `maxDepth` 仍 `too_large`：生成前置准备任务或范围受限任务，不继续拆。
- 用户修改 objective：重置 plan tree，`planRevision += 1`。
- 旧 memory 迁移失败：保留旧 `items` 路径，并记录 errorReason，避免丢失 supervisor。

## 12. 测试计划

Server evaluator tests：

- 解析 `ready_check` 输出。
- 拒绝缺少 `granularity` 的 ready check。
- 解析 `decompose_child` children。
- 拒绝空 children。
- 解析 fallback `executable_task` guidance。

Server manager tests：

- 没有 `planTree` 时从高层 objective 生成 root children。
- legacy `items` 可以迁移成 synthetic root。
- active node `too_large` 且未到 `maxDepth` 时只拆当前节点。
- sibling 不被提前拆分。
- current branch 递归拆到 ready 后注入 guidance。
- 达到 `maxDepth` 仍不 ready 时生成 fallback executable task。
- leaf done 后推进到下一个 sibling。
- 所有 children done 后 parent roll up 为 done。

Web tests：

- tree view 渲染 root、children、active branch。
- execution focus panel 展示 active leaf path、ready check、deliverable、acceptance criteria。
- legacy supervisor memory 仍可展示基本状态。

Integration tests：

- 创建 supervisor 后，首次 trigger 可以生成高层树并递归到 executable leaf。
- agent 完成 leaf 后，下一次 trigger 推进到 sibling。
- evaluator failure 不破坏已有 plan tree。

## 13. 实施分期建议

### Phase 1: Backend tree memory and evaluator schemas

- 增加 plan node 类型。
- 实现 legacy `items` 到 tree 的兼容转换。
- 扩展 evaluator result parser。
- 加 ready check、decompose child、executable task 单测。

### Phase 2: Manager recursive preparation flow

- 增加 `prepareExecutableNode`。
- 在注入 guidance 前先执行 ready gate。
- 实现 maxDepth fallback。
- 实现 leaf completion 和 parent rollup。

### Phase 3: UI mind map and execution focus

- 在 details 中展示 tree/mind map。
- 展示 active leaf path 和 ready check。
- 保持现有 card 操作不变。

## 14. 验收标准

该设计实现完成后，应满足：

1. “写 100 万字小说”这类大目标不会直接下发“写第一卷 20 万字”给 agent。
2. 初始计划可以只生成高层节点。
3. Supervisor 只递归拆当前 active branch。
4. 当前 leaf 只有通过 ready check 后才会被注入给 agent。
5. 达到 maxDepth 仍不 ready 时，会生成前置准备任务或范围受限任务。
6. UI 能看到全局计划树和当前执行路径。
7. 旧 supervisor memory 不会因为新模型无法读取。
