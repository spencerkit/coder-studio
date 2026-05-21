# supervisor 恢复列表会把失败 reset 后仅存的备份目标过滤掉

## 标题

`fix(server): listRecoverableTargets 不应无条件忽略 backup/reset 目录`

## 问题描述

`listRecoverableTargets()` 当前会把名称包含 `.backup-` 和 `.reset-` 的目录全部视为临时目录并过滤掉。

这个过滤在正常路径下可以隐藏 reset 过程中的中间产物，但在 reset 失败或进程中断的异常路径下，磁盘上可能只剩下 `backup` 或 `reset staging` 目录可用。如果此时无条件过滤，这些目录里的唯一可恢复数据就不会再出现在 restore 列表里。

## 复现步骤

1. 创建一个带有 supervisor target 的工作区。
2. 触发一次 `resetTargetFiles()`。
3. 让 reset 在“旧目录已 rename 为 backup、新目录尚未成功 promote”这一阶段失败，或在这一阶段发生崩溃/中断。
4. 重新进入恢复流程，调用 `listRecoverableTargets()`。
5. 观察返回的可恢复目标列表。

## 预期行为

- 即使 reset 失败，只要磁盘上仍然存在可读的 target 数据，就应该有办法在恢复列表里看到它。
- 至少不应该因为目录名带有 `.backup-` / `.reset-` 就直接丢失唯一剩余的恢复入口。

## 实际行为

- `listRecoverableTargets()` 会无条件跳过 `.backup-*` / `.reset-*` 目录。
- 在正式 target 目录已经消失，而仅剩 backup 或 staging 副本时，恢复列表可能直接为空。

## 已确认事实

- `resetTargetFiles()` 的失败路径下，确实可能留下：
  - 正式目录不存在
  - `backup` 目录存在
  - `reset staging` 目录存在
- 当前已有原子测试覆盖这种磁盘残局形态。
- `listRecoverableTargets()` 当前没有根据“是否存在正式 target 目录”或“哪份副本是唯一可恢复副本”做更细粒度判断。

## 当前判断

这是 restore 入口的容灾回归。

问题不在于“临时目录本身不该隐藏”，而在于当前过滤过于绝对，没有给异常残局保留降级恢复路径。结果是磁盘上明明还有数据，但产品层面完全失去恢复入口。

## 后续处理方向

- 不要对 `.backup-*` / `.reset-*` 做无条件过滤。
- 改为更细粒度的恢复候选选择逻辑，例如：
  - 正式 target 存在时，优先展示正式目录并隐藏其伴随 backup/staging
  - 正式 target 不存在时，允许把唯一可恢复的 backup/staging 暴露出来
- 需要补一组异常残局下的恢复列表测试，覆盖“只剩 backup”与“只剩 staging”的情况
