export const DEFAULT_AGENT_AUTOMATION_PERMISSIONS = [
  "workspace:read",
  "session:read",
  "terminal:read",
  "git:read",
] as const;

export type AutomationPermission = (typeof DEFAULT_AGENT_AUTOMATION_PERMISSIONS)[number];
export type AutomationRiskLevel = "read" | "write" | "dangerous";

export interface IdentifyInput {
  env?: Record<string, string | undefined>;
  cwd?: string;
}

export interface IdentifyResult {
  insideCoderStudio: boolean;
  workspaceId?: string;
  sessionId?: string;
  terminalId?: string;
  providerId?: string;
  cwd?: string;
  apiUrl?: string;
  permissions?: readonly AutomationPermission[];
}

export interface AutomationCapability {
  name: string;
  cli: string;
  description: string;
  inputSchema: Record<string, string>;
  output: string;
  permissions: AutomationPermission[];
  riskLevel: AutomationRiskLevel;
  examples: string[];
  available: boolean;
}

const MVP_CAPABILITIES: AutomationCapability[] = [
  {
    name: "workspace.list",
    cli: "coder-studio workspace list",
    description: "List known workspaces.",
    inputSchema: {},
    output: "Workspace summaries as JSON.",
    permissions: ["workspace:read"],
    riskLevel: "read",
    examples: ["coder-studio workspace list --json"],
    available: true,
  },
  {
    name: "session.list",
    cli: "coder-studio session list",
    description: "List sessions for a workspace.",
    inputSchema: { workspaceId: "string" },
    output: "Session summaries as JSON.",
    permissions: ["session:read"],
    riskLevel: "read",
    examples: ["coder-studio session list --workspace ws_123 --json"],
    available: true,
  },
  {
    name: "terminal.read",
    cli: "coder-studio terminal read",
    description: "Read terminal output tail.",
    inputSchema: { terminalId: "string", bytes: "number optional" },
    output: "Terminal text tail.",
    permissions: ["terminal:read"],
    riskLevel: "read",
    examples: ["coder-studio terminal read --terminal term_123 --json"],
    available: true,
  },
  {
    name: "git.status",
    cli: "coder-studio git status",
    description: "Read Git status for a workspace.",
    inputSchema: { workspaceId: "string" },
    output: "Git status summary as JSON.",
    permissions: ["git:read"],
    riskLevel: "read",
    examples: ["coder-studio git status --workspace ws_123 --json"],
    available: true,
  },
  {
    name: "git.diff",
    cli: "coder-studio git diff",
    description: "Read Git diff for a workspace file.",
    inputSchema: { workspaceId: "string", path: "string", staged: "boolean optional" },
    output: "Git diff text or structured diff data.",
    permissions: ["git:read"],
    riskLevel: "read",
    examples: ["coder-studio git diff --workspace ws_123 --path src/a.ts --json"],
    available: true,
  },
];

export function buildIdentifyResult(input: IdentifyInput = {}): IdentifyResult {
  const env = input.env ?? process.env;
  if (env.CODER_STUDIO !== "1") {
    return { insideCoderStudio: false };
  }

  return {
    insideCoderStudio: true,
    workspaceId: env.CODER_STUDIO_WORKSPACE_ID,
    sessionId: env.CODER_STUDIO_SESSION_ID,
    terminalId: env.CODER_STUDIO_TERMINAL_ID,
    providerId: env.CODER_STUDIO_PROVIDER_ID,
    cwd: input.cwd ?? process.cwd(),
    apiUrl: env.CODER_STUDIO_API_URL,
    permissions: DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  };
}

export function listAutomationCapabilities(input: {
  permissions: readonly string[];
}): AutomationCapability[] {
  const allowed = new Set(input.permissions);
  return MVP_CAPABILITIES.filter((capability) =>
    capability.permissions.every((permission) => allowed.has(permission))
  );
}
