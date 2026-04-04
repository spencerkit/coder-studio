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
