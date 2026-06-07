# OpenCode 在 Linux Web 终端里偶发出现异常字符被写入输入框

## 标题

`investigate(web): OpenCode 在 Linux 浏览器终端里偶发出现异常字符被写入输入框`

## 问题描述

在 `coder-studio` 的 OpenCode session 场景下，用户偶发观察到 OpenCode 自己的输入框里出现一串并非主动输入的字符，内容表现为大写字母、小写字母、数字和符号混杂的异常文本。

从截图看，这些字符不是模型输出到历史区，而是直接出现在 OpenCode 底部 prompt / composer 输入框内，视觉上像“有人替用户敲了一串乱码”。

目前该问题是**偶发**的。当前还没有形成稳定复现步骤；本次继续排查时也**没有再次复现**。

## 已观察到的现象

- 异常内容出现在 OpenCode 的输入框，而不是普通 terminal 输出区。
- 字符串形态不像自然语言，也不像正常命令，更像一串异常按键流、粘贴流或错误解码后的可打印字符。
- 同类现象目前主要在 **Linux + 浏览器中的 coder-studio Web terminal** 场景被报告。
- 用户反馈：
  - 直接在系统终端里运行 OpenCode，好像没有遇到。
  - Windows 上好像也没有遇到。

## 复现步骤

当前**没有稳定复现步骤**。

已知上下文：

1. 在 `coder-studio` 中打开 OpenCode agent session。
2. 正常使用 OpenCode 的 TUI 输入框。
3. 偶发看到输入框里被填入一串异常字符。

补充说明：

- 本次排查过程中没有成功再次复现。
- 现阶段更适合把这条记录为 intermittent / flaky issue，而不是宣称已有稳定复现链路。

## 预期行为

OpenCode 输入框只应显示用户真实输入的内容，或产品明确注入的受控文本；不应出现来源不明的异常字符。

## 实际行为

OpenCode 输入框偶发出现用户并未主动输入的字符，表现为输入框内容被“污染”或“鬼打字”。

## 已确认事实

- `coder-studio` 对 OpenCode 的 provider 接入很薄，主要只是启动 `opencode` 命令，本身没有发现“自动向 prompt 注入文本”的逻辑。
- OpenCode provider 启动路径位于：
  - `packages/providers/src/opencode/definition.ts`
- Web terminal 的输入路径基本是：
  - `xterm.onData(...)`
  - `handleInput(...)`
  - `wsClient.sendTerminalInput(...)`
  - PTY stdin
- 对应实现位于：
  - `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- 当前没有发现 `coder-studio` 在 OpenCode session 中主动拼接这类随机文本的代码路径。
- 当前前端对普通键盘输入的处理更接近“收到什么就往 PTY 发什么”，因此如果浏览器 / xterm / 输入法层产生了异常输入流，OpenCode 很可能会把它当成普通文本显示在自己的输入框里。
- 相关本地环境线索：
  - `opencode 1.15.13`
  - Web 侧使用 `@xterm/xterm ^6.0.0`
  - `TERM=xterm-256color`
  - 当前排查环境未使用 `tmux`
  - 当前图形会话可见 `WAYLAND_DISPLAY=wayland-0`

## 当前判断

当前更像是 **Linux 浏览器 terminal 输入链路问题**，而不是 OpenCode 自己凭空生成了这串文本。

更具体地说，可疑边界在：

- 浏览器键盘事件
- `xterm.js` 的隐藏输入层 / IME / composition
- 剪贴板或粘贴事件
- Wayland / 浏览器 / 输入法之间的偶发输入异常

OpenCode 只是把收到的可打印输入显示进了自己的 composer。

## 已排除或暂不优先的方向

- 暂无证据表明是模型输出错误地回显到了输入框。
- 暂无证据表明 `coder-studio` provider 层主动生成了这串字符。
- 暂无证据表明是 `tmux`、`kitty` 一类终端复用层特有问题；当前排查环境里并没有这些中间层。

## 后续排查方向

- 在 Web terminal 输入桥接层增加可开关的诊断日志，记录异常时真正发给 PTY 的原始输入字节。
- 对比不同浏览器：
  - Chromium / Chrome
  - Firefox
- 对比 Linux 图形后端：
  - Wayland
  - X11 / XWayland
- 复现时同步记录：
  - 当前输入法
  - 是否刚发生过粘贴
  - 是否有剪贴板增强工具 / 文本展开工具 / 键盘宏工具
  - 浏览器 console 中的 terminal trace
- 如果后续能在系统终端之外、但在最小化 `xterm.js` demo 中复现，再考虑向 `xterm.js` 或 OpenCode 上游提交更精确的问题报告。

## 当前状态

- 已记录问题现象和当前诊断边界。
- 问题仍属 **偶发**。
- 当前 **未稳定复现**。
