# supervisor 编辑弹框会被实时状态更新错误地标记为已修改

## 标题

`fix(web): supervisor 编辑弹框的 hasChanges 应基于打开时快照而非实时 supervisor 状态`

## 问题描述

当前 supervisor 编辑弹框里的 `hasSettingsChanged` 不是拿草稿和“弹框打开时的初始值”比较，而是直接拿草稿和“当前实时 supervisor 状态”比较。

这意味着只要弹框打开期间，另一个标签页、另一个客户端，或其他后端状态更新修改了 evaluator/model/max count/scheduledAt，当前页面即使一项都没改，也可能被错误标记为“表单已修改”。

## 复现步骤

1. 打开一个已存在 supervisor 的编辑弹框。
2. 保持当前弹框内容不变。
3. 在另一处把这个 supervisor 的 evaluator、model、max count 或 scheduledAt 改掉。
4. 让当前页面收到新的 `supervisor.state` 推送。
5. 观察当前编辑弹框的 Save 按钮状态。

## 预期行为

- “是否有修改” 应只反映当前弹框内用户相对打开瞬间基线所做的本地修改。
- 外部状态变化不应把一个未编辑的表单错误点亮。

## 实际行为

- 外部更新后，当前页面即使没有本地改动，也可能把 Save 点亮。
- 用户如果继续保存，可能会把旧草稿值覆盖回实时值，形成误保存。

## 已确认事实

- objective 的变更判断当前已基于 `initialObjective` 快照。
- evaluator/model/max count/scheduledAt 的变更判断当前仍直接依赖实时 `supervisor`。
- 该问题是这次新增 `hasSettingsChanged` 逻辑后引入的基线不一致。

## 当前判断

这是一个典型的编辑态并发基线问题。

当前实现把“表单初始值”和“外部实时状态”混成了一个基准，导致 dirty-check 语义不稳定。只要弹框开着期间外部状态变化，就会出现假阳性，严重时会让用户把旧值再次写回。

## 后续处理方向

- 为 evaluator/model/max count/scheduledAt 增加与 `initialObjective` 同级的初始快照字段。
- `hasChanges` 统一基于弹框打开时的初始快照比较，而不是直接读取实时 `supervisor`。
- 补测试覆盖：
  - 打开弹框后外部状态变化，但当前页未编辑时 Save 仍应禁用
  - 打开弹框后外部状态变化，当前页有本地修改时仍应只按本地差异判断
