export const AGENT_SPECIAL_KEYS = [
  { labelKey: "escKey", sequence: "\u001b", key: "Escape" },
  { labelKey: "tabKey", sequence: "\t", key: "Tab" },
  { labelKey: "enterKey", sequence: "\r", key: "Enter" },
  { labelKey: "arrowUp", sequence: "\u001b[A", key: "ArrowUp" },
  { labelKey: "arrowDown", sequence: "\u001b[B", key: "ArrowDown" },
  { labelKey: "arrowLeft", sequence: "\u001b[D", key: "ArrowLeft" },
  { labelKey: "arrowRight", sequence: "\u001b[C", key: "ArrowRight" }
] as const;

export const AGENT_SPECIAL_KEY_MAP = Object.fromEntries(
  AGENT_SPECIAL_KEYS.map((item) => [item.key, item.sequence])
) as Record<string, string>;

export const AGENT_START_SYSTEM_MESSAGE = "Agent started / 智能体已启动";
export const AGENT_STARTUP_DISCOVERY_MS = 1200;
export const AGENT_STARTUP_QUIET_MS = 240;
export const AGENT_STARTUP_MAX_WAIT_MS = 5000;
export const AGENT_STREAM_BUFFER_LIMIT = 200_000;
export const TERMINAL_STREAM_BUFFER_LIMIT = 200_000;
export const SESSION_MESSAGE_LIMIT = 200;
export const WS_STREAM_FLUSH_INTERVAL_MS = 48;
export const AGENT_TITLE_TRACK_LIMIT = 240;

export const BUILTIN_SLASH_COMMANDS: Array<{ command: string; description: { en: string; zh: string } }> = [
  { command: "/help", description: { en: "Show help and available commands.", zh: "显示帮助和当前可用命令。" } },
  { command: "/compact", description: { en: "Compact the current conversation with optional focus instructions.", zh: "压缩当前会话上下文，并可附带聚焦说明。" } },
  { command: "/clear", description: { en: "Clear conversation history and free up context.", zh: "清空当前会话历史并释放上下文。" } },
  { command: "/config", description: { en: "Open Claude Code settings and preferences.", zh: "打开 Claude Code 设置与偏好。" } },
  { command: "/diff", description: { en: "Open the interactive diff viewer for current changes.", zh: "打开当前改动的交互式差异视图。" } },
  { command: "/init", description: { en: "Initialize the project with a CLAUDE.md guide.", zh: "为当前项目初始化 CLAUDE.md 指南。" } },
  { command: "/mcp", description: { en: "Manage MCP server connections and authentication.", zh: "管理 MCP 服务连接与认证。" } },
  { command: "/memory", description: { en: "Edit and manage CLAUDE.md memory files.", zh: "编辑和管理 CLAUDE.md 记忆文件。" } },
  { command: "/permissions", description: { en: "View or update Claude tool permissions.", zh: "查看或更新 Claude 的工具权限。" } },
  { command: "/plan", description: { en: "Enter plan mode directly from the prompt.", zh: "直接进入计划模式。" } },
  { command: "/resume", description: { en: "Resume a conversation by ID or name.", zh: "按 ID 或名称恢复历史会话。" } },
  { command: "/status", description: { en: "Open the status view for model, account, and connectivity.", zh: "打开状态视图，查看模型、账号和连接信息。" } }
];

export const BUNDLED_CLAUDE_SKILLS: Array<{ command: string; description: { en: string; zh: string } }> = [
  { command: "/batch", description: { en: "Plan and execute large codebase changes in parallel worktrees.", zh: "并行规划并执行大规模代码库改造。" } },
  { command: "/claude-api", description: { en: "Load Claude API and SDK reference material for the current project.", zh: "加载当前项目相关的 Claude API 与 SDK 参考资料。" } },
  { command: "/debug", description: { en: "Inspect the current Claude Code session and debug issues.", zh: "检查当前 Claude Code 会话并诊断问题。" } },
  { command: "/loop", description: { en: "Repeat a prompt on an interval while the session stays open.", zh: "在会话保持打开时按固定间隔重复执行提示词。" } },
  { command: "/simplify", description: { en: "Review recent changes for quality and simplification opportunities.", zh: "检查最近改动并寻找质量与简化机会。" } }
];

export const replaceLeadingSlashToken = (input: string, command: string) => {
  const trimmed = input.replace(/^\s+/, "");
  const remainder = trimmed.replace(/^\/\S+\s*/, "");
  return remainder ? `${command} ${remainder}` : `${command} `;
};
