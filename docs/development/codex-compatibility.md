# Codex Support Alignment

## 真实验证结论

- 验证时间：2026-03-30
- 验证版本：`codex-cli 0.117.0`
- 已在真实 CLI 上验证通过的链路：
  - `codex --enable codex_hooks ...` 可以触发 workspace 级 `.codex/hooks.json`
  - `SessionStart` / `UserPromptSubmit` hook payload 会真实包含 `session_id`
  - `codex resume <session_id> --enable codex_hooks ...` 会继续写回同一个 `session_id`
  - 当前后端采用的参数顺序 `codex resume <id> ...` 对 Codex CLI 0.117.0 是可工作的
  - 新 workspace 现在不会再被后端预写一个默认 `claude` session，首个 draft session 的 provider 选择可以真实生效
- 已确认的真实差异：
  - 如果不显式打开 `codex_hooks` feature，`.codex/hooks.json` 即使存在也不会触发
  - 首次进入一个未信任 repo 时，Codex 会先弹目录信任确认，这一点和 Claude 不对齐
  - `codex-cli 0.117.0` 的交互式 TUI 在受控 PTY 下对 stdin 驱动并不稳定：
    - 在 Coder Studio 真实 UI 联调里，首条 prompt 可以被写入 Codex 输入框，但不会稳定触发一次真正的提交，因此 `resume_id` 不会回填
    - 直接对真实 PTY 注入 prompt 时，Codex 还可能在 `tui_app_server/src/wrapping.rs` 崩溃
  - 结论上，当前版本的 Codex 不能像 Claude 一样可靠地依赖“启动一个常驻 TUI + 后续通过 stdin 持续喂输入”这条链路
- 本地回归脚本：
  - `pnpm test:smoke:codex -- --workspace <trusted-workspace-path>`
  - 这个脚本不会进 CI，默认假设该 workspace 已经被 Codex trust，且本机已经完成 Codex 登录

## 已对齐

- Session 恢复真值已统一为 `provider + resume_id`，不再保留 Claude-only 的 `claude_session_id` 语义。
- 新建 draft session 时，用户可以直接选择 `Claude` 或 `Codex`。
- 新 workspace 首次进入时，不会再被默认落成一个隐藏的 `claude` session；provider 选择不再被后端默认值覆盖。
- `agent_start` 不再接收也不再信任前端传入的 provider；后端只读取持久化后的 `session.provider` 和 `session.resume_id`。
- 恢复语义与 Claude 对齐：
  - 有 `resume_id` 时直接尝试 resume
  - 没有 `resume_id` 时走 restart
- 后端现在有一个通用的 agent-client adapter 层：
  - 公共链路只负责读取 session 真值、启动 PTY、注入共享环境变量
  - `claude-client` / `codex-client` 各自负责 `start` / `resume` 命令差异和 workspace hooks
- Codex 启动命令规则已与既定方案对齐：
  - 无 `resume_id` 时：`codex ... --enable codex_hooks`
  - 有 `resume_id` 时：`codex resume <resume_id> ... --enable codex_hooks`
- workspace 级 `.codex/hooks.json` 会在启动前自动写入或更新，且启动命令会显式打开 `codex_hooks` feature，Codex hook 回传的 `session_id` 会统一写入 session 的 `resume_id`。
- 前端会话链路已 provider-aware：
  - session/history/recovery 全部改为使用 `provider + resumeId`
  - 历史列表和会话 pane 会显示 provider
  - runtime validation 会按当前选中的 provider 校验实际 CLI，不再固定写死 Claude
- 前端已经去掉 `tab.agent` 作为业务真值；provider 和 command 都改成按 session + target 动态推导。
- Settings 已和 Claude 方案在信息架构上对齐到同一层级：
  - General 面板可设置默认 provider
  - Claude 和 Codex 分别有独立 provider panel
  - Codex 已支持 `global / native / wsl` 三层覆盖
  - Codex settings schema 已扩展为：
    - `executable`
    - `extra_args`
    - `env`
    - `model`
    - `approval_policy`
    - `sandbox_mode`
    - `web_search`
    - `model_reasoning_effort`
- Codex settings 现在会按官方 CLI 语义落到启动命令：
  - 结构化字段会在启动时追加为 `--config key=value`
  - `extra_args` 仍然保留为原始 CLI 参数兜底层
- Codex settings 会参考本地现有配置：
  - Native 会从 `~/.codex/config.toml` hydrate 缺省值
  - WSL 会从对应 Linux home 下的 `~/.codex/config.toml` hydrate 缺省值

## 无法完全对齐 / 接受降级

- 不设计 auth flow。Claude/Codex 的认证都由用户自行在本地 CLI 环境中配置。
- Claude 面板里的 auth / advanced JSON 编辑能力，没有原样搬到 Codex：
  - Codex 这一轮只暴露官方稳定、且可以直接映射到 CLI `--config` 的顶层字段
  - 没有为了“看起来一致”去做一层伪 JSON/TOML 编辑器
- Codex 官方 config 仍有一部分没有纳入这轮 UI：
  - `profiles.*`
  - 更复杂的 `approval_policy` object 形态
  - 各类嵌套 table / provider transport 细项
- 当前不会替用户写入或改写 `~/.codex/config.toml` / workspace `.codex/config.toml`：
  - 读取会做 hydrate
  - 启动覆盖通过 `--config` 完成
  - 这样可以避免 Coder Studio 去篡改用户自己的 Codex 配置文件
- Codex hooks 目前仍然是实验特性：
  - 需要启动命令显式追加 `--enable codex_hooks`
  - 当前实现已经在运行时强制打开这个 feature，但这仍然是对实验能力的依赖
- slash / skills 相关逻辑仍然是 Claude-only，这一轮没有给 Codex 做同级支持。
- 没有做 Codex native Windows 的专门兼容增强；Windows 下如果 CLI 或 hooks 行为不同，当前按降级处理。
- 未信任目录下的 trust prompt 没有被抹平：
  - Coder Studio 只能把它透传到终端里由用户确认
  - 当前不会在启动前替用户预写 trust 配置
- Codex resume 能力默认依赖 hooks 正常可用；如果目标环境不支持 hooks，session 仍可启动，但 resume 的稳定性不保证和 Claude 完全一致。
- Codex 交互式输入目前不能和 Claude 完全对齐：
  - Claude 当前链路依赖“常驻 PTY + stdin 注入”
  - Codex CLI 0.117.0 在这条链路上存在真实兼容性问题
  - 当前版本里，provider 选择、session 持久化、start/resume 命令、hooks 回传都已对齐，但“在 Coder Studio 内持续向 Codex TUI 注入后续 prompt”这一层仍未可靠打通

## 建议降级方案

- 如果要在当前 Codex CLI 版本上继续推进，可优先改为“turn-based process”模型：
  - 首条 prompt 走 `codex [PROMPT]`
  - 后续 prompt 走 `codex resume <resume_id> [PROMPT]`
  - 不再把 Codex 当成一个需要长期保活、持续写 stdin 的交互式 TUI
- 这条方案可以保留 session / history / resume 语义，但行为上会和 Claude 的常驻终端模式存在差异，需要作为明确降级接受。

## 后续可收敛方向

- 如果 Codex CLI 的稳定配置面继续扩展，再把更多结构化字段纳入 settings schema，而不是继续堆 `extra_args`。
- 如果后续确实需要和 Codex 官方文件模型更深度绑定，再评估：
  - 是否增加 project-level `.codex/config.toml` 写入
  - 是否支持 profile 选择 / profile 编辑
- 如果后续确认 Codex hooks payload 和 Claude hooks payload 存在更多生命周期差异，再补一层更完整的 lifecycle normalization。
