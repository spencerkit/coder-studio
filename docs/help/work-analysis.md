# 工作分析

## 这篇文档解决什么问题

帮助你理解 `工作分析` 能看什么、怎么筛选，以及 `基础分析` 和 `深入分析` 的区别。

## 前置条件

- 至少打开一个工作区，让 Coder Studio 知道要分析哪个 workspace path
- 该 workspace 在所选时间范围内最好有 provider 本地日志
- 不要求当前有打开中的 Coder Studio session

## 怎么用

1. 打开设置页，进入 `工作分析`
2. 选择一个或多个工作区
3. 选择时间范围
4. 先运行 `基础分析`
5. 如需更高维度结论，再运行 `深入分析`

## 基础分析会给出什么

- 覆盖范围：命中的工作区数、provider 本地会话数、provider 数
- 活动统计：总时长、平均会话时长、用户/助手/工具调用信号
- 工作时间：provider 本地会话主要发生在哪些小时段
- Provider 结构：常用 provider 分布，以及每个 provider 的日志状态
- Skill 资产：已安装、已挂载、未挂载的 skill 数量

这部分会扫描 provider 保存在本机的日志或缓存数据，目前覆盖 5 个内置 provider：`claude`、`codex`、`gemini`、`cursor`、`opencode`。

不同 provider 的数据质量可能不同：

- 有些 workspace 在选定时间范围内没有匹配日志
- 有些 provider 只能返回部分数据
- 有些会话缺少明确时间戳，只能回退到文件修改时间

## 深入分析会给出什么

- 工作内容总结
- 重复出现的工作模式
- 主要瓶颈
- 流程改进建议
- 可沉淀为 skill 的候选项

这部分会把基础分析结果和从 provider 日志中采样出来的代表性证据交给 headless agent，所以成本更高，也依赖 provider 的 headless 能力。

## 当前限制

- skill 使用次数不是 v1 的强保证，目前主要是 inventory 视角
- 不同 provider 可读到的数据并不完全对称
- 本地 provider 日志可能缺失、部分损坏，或者因时间戳缺失而回退到文件修改时间
- 深入分析失败不会影响基础分析结果

## 下一步

- 想先了解整体产品结构，可以看 [App 功能总览](app-overview.md)
- 想结合真实使用场景，可以看 [常见工作流](workflows.md)
