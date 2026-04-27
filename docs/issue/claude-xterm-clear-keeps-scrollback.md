# Claude 清屏后 xterm.js 仍可见旧历史内容

## 标题

`fix(web): Claude 清屏后 xterm.js 仍可见旧历史内容`

## 问题描述

在 `coder-studio` 的 Claude session 场景下，执行 `/clear`，或在 agent 触发上下文压缩/界面重绘后，terminal 画面会被重新刷一遍，但旧内容并没有真正从可滚动历史里消失。用户向上滚动时仍能看到之前的输出，视觉上像清屏没有清干净，或者界面错乱。

该问题目前主要在 web 端 `xterm.js` 容器中观察到；同样的 Claude 行为在 iTerm、Wave、PowerShell 这类桌面终端里观感正常。

## 复现步骤

1. 打开 `coder-studio` 中的 Claude terminal session。
2. 在会话中产生较多输出。
3. 执行 `/clear`，或等待 Claude 因上下文压缩/某些内部操作触发界面清理。
4. 观察当前可视区域会被重绘。
5. 向上滚动，仍可看到旧输出内容。

## 预期行为

清屏后，用户不应再看到此前的旧界面内容；至少不应产生当前界面已清空但历史里仍是上一帧残影的错觉。

## 实际行为

当前 viewport 被重绘，但 scrollback 中仍保留旧内容，导致清屏后继续上滚会看到旧输出，观感异常。

## 已确认事实

- 问题不是只由 `/clear``/compact` 触发，Claude 还有其他内部路径会触发类似清屏/重绘效果。
- coder-studio 的 WS、PTY、ring-buffer 数据链路没有明显证据表明丢失或篡改了控制序列。
- `xterm.js` 本身支持 `ESC[3J` 清除 scrollback。
- Claude 二进制中存在两套相关机制：
  - `enterAlternateScreen()` / `exitAlternateScreen()`，会发 `?1049h` / `?1049l` 与 `2J` / `H`
  - Ink renderer 的 `clearTerminal` / `[REPAINT] full reset` 路径
- 当前抓包里没有稳定观察到 `/clear` 触发 `?1049h` / `?1049l` 或 `3J`。
- `xterm-256color` 的 terminfo `clear` 默认只有 `ESC[H ESC[2J`，不会清 scrollback；要隐藏旧历史通常需要 `3J` 或 alt-screen。

## 当前判断

Claude 在 web 场景下很多时候走的是 Ink 的 full reset / repaint 路径，而不是 alt-screen 切换。

这条路径只会清当前屏幕区域，不会清 scrollback；`xterm.js` 又忠实保留历史，因此用户上滚时还能看到旧内容，形成清屏未完成的观感。

桌面终端之所以更正常，可能是 Claude 在那些环境下更容易进入 alt-screen 路径，或者终端对这类重绘的呈现方式更接近原生预期。

## 后续排查方向

- 在 server 侧为 Claude 会话增加诊断日志，记录：
  - `TERM`
  - `TERM_PROGRAM`
  - `COLORTERM`
  - rows / cols
  - 输出中是否出现 `?1049h` / `?1049l` / `2J` / `3J`
- 对比 iTerm / Wave 与 web PTY 环境差异，确认是什么条件导致 Claude 选择不同清屏路径。
- 评估是否需要：
  - 让 Claude 会话环境更接近桌面终端
  - 或在前端对 Claude full reset 做专门处理
