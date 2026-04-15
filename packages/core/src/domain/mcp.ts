/**
 * MCP Server Types (Phase 4)
 *
 * Types for MCP (Model Context Protocol) server management.
 */

export interface McpServerConfig {
  /** Server name/identifier */
  name: string;
  /** Server command (e.g., 'npx', 'node', 'python') */
  command: string;
  /** Command arguments */
  args: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Whether the server is enabled */
  enabled: boolean;
  /** Server description */
  description?: string;
}

export interface McpServerStatus {
  /** Server name */
  name: string;
  /** Connection status */
  status: 'connected' | 'disconnected' | 'error' | 'starting';
  /** Last error message */
  error?: string;
  /** Available tools from this server */
  tools?: string[];
  /** Available resources from this server */
  resources?: string[];
}

export interface McpConfig {
  /** MCP servers by provider */
  servers: {
    claude: McpServerConfig[];
    codex: McpServerConfig[];
  };
}
