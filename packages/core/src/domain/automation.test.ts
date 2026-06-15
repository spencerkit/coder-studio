import { describe, expect, it } from "vitest";
import {
  buildIdentifyResult,
  DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  listAutomationCapabilities,
} from "./automation.js";

describe("automation domain", () => {
  it("returns outside-Coder-Studio when env marker is absent", () => {
    expect(buildIdentifyResult({ env: {} })).toEqual({ insideCoderStudio: false });
  });

  it("returns runtime context from Coder Studio env", () => {
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_WORKSPACE_ID: "ws-1",
          CODER_STUDIO_SESSION_ID: "sess-1",
          CODER_STUDIO_TERMINAL_ID: "term-1",
          CODER_STUDIO_PROVIDER_ID: "codex",
          CODER_STUDIO_API_URL: "http://127.0.0.1:4173",
        },
        cwd: "/repo",
      })
    ).toEqual({
      insideCoderStudio: true,
      workspaceId: "ws-1",
      sessionId: "sess-1",
      terminalId: "term-1",
      providerId: "codex",
      cwd: "/repo",
      apiUrl: "http://127.0.0.1:4173",
      permissions: DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
    });
  });

  it("lists capabilities allowed by caller permissions", () => {
    const capabilities = listAutomationCapabilities({
      permissions: DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
    });
    const memoryAdd = capabilities.find((capability) => capability.name === "memory.add");
    const memoryUpdate = capabilities.find((capability) => capability.name === "memory.update");
    const memoryCapabilities = capabilities.filter((capability) =>
      capability.name.startsWith("memory.")
    );
    const memoryExamples = memoryCapabilities.flatMap((capability) => capability.examples);

    expect(capabilities.map((capability) => capability.name)).toContain("git.status");
    expect(DEFAULT_AGENT_AUTOMATION_PERMISSIONS).toContain("memory:read");
    expect(DEFAULT_AGENT_AUTOMATION_PERMISSIONS).toContain("memory:write");
    expect(capabilities.find((capability) => capability.name === "git.status")).toMatchObject({
      cli: "coder-studio git status",
      permissions: ["git:read"],
      riskLevel: "read",
      available: true,
    });
    expect(capabilities.find((capability) => capability.name === "session.list")).toMatchObject({
      inputSchema: { workspaceId: "string" },
      examples: ["coder-studio session list --workspace ws_123 --json"],
    });
    expect(capabilities.find((capability) => capability.name === "git.diff")).toMatchObject({
      inputSchema: { workspaceId: "string", path: "string", staged: "boolean optional" },
      examples: ["coder-studio git diff --workspace ws_123 --path src/a.ts --json"],
    });
    expect(capabilities.find((capability) => capability.name === "memory.list")).toMatchObject({
      cli: "coder-studio memory list",
      permissions: ["memory:read"],
      riskLevel: "read",
      examples: ["coder-studio memory list --workspace ws_123 --json"],
    });
    expect(capabilities.find((capability) => capability.name === "memory.search")).toMatchObject({
      description: "Search workspace memory entries by content or type.",
      examples: ['coder-studio memory search "testing" --workspace ws_123 --json'],
    });
    expect(
      capabilities.find((capability) => capability.name === "memory.search")?.inputSchema
    ).toEqual({ workspaceId: "string", query: "string" });
    expect(memoryAdd).toMatchObject({
      permissions: ["memory:write"],
      riskLevel: "write",
      examples: [
        'coder-studio memory add --workspace ws_123 --type project --content "..." --json',
      ],
    });
    expect(memoryAdd?.examples).toEqual([
      'coder-studio memory add --workspace ws_123 --type project --content "..." --json',
    ]);
    expect(memoryAdd?.inputSchema).toEqual({
      workspaceId: "string",
      type: "feature | todo | bugfix | project | note",
      content: "string",
    });
    expect(memoryAdd?.inputSchema).not.toHaveProperty("tags");
    expect(memoryUpdate?.inputSchema).toEqual({
      workspaceId: "string",
      id: "string",
      type: "feature | todo | bugfix | project | note optional",
      content: "string optional",
    });
    expect(memoryUpdate?.inputSchema).not.toHaveProperty("tags");
    expect(memoryUpdate).toMatchObject({
      examples: ['coder-studio memory update mem_abc --workspace ws_123 --content "..." --json'],
    });
    expect(memoryUpdate?.examples).toEqual([
      'coder-studio memory update mem_abc --workspace ws_123 --content "..." --json',
    ]);
    expect(memoryExamples).toSatisfy((examples) =>
      examples.every((example) => !example.includes("--tag"))
    );
    expect(memoryAdd?.inputSchema.type).not.toContain("project_fact");
    expect(memoryUpdate?.inputSchema.type).not.toContain("project_fact");
    expect(memoryExamples).toSatisfy((examples) =>
      examples.every((example) => !example.includes("project_fact"))
    );
  });

  it("includes low-risk UI action permissions in the default agent permissions", () => {
    expect(DEFAULT_AGENT_AUTOMATION_PERMISSIONS).toEqual(
      expect.arrayContaining(["ui:read", "ui:navigate", "ui:command"])
    );
  });

  it("lists UI action capabilities through automation capabilities", () => {
    const capabilities = listAutomationCapabilities({
      permissions: DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
    });

    expect(capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "ui.editor.openFile",
          cli: "coder-studio ui open-file --path <workspace-relative-path>",
          permissions: ["ui:navigate"],
        }),
        expect.objectContaining({
          name: "ui.editor.closeFile",
          cli: "coder-studio ui close-file --path <workspace-relative-path>",
          permissions: ["ui:navigate"],
        }),
        expect.objectContaining({
          name: "ui.browser.closeUrl",
          cli: "coder-studio ui close-url --url <localhost-url>",
          permissions: ["ui:navigate"],
        }),
        expect.objectContaining({
          name: "ui.command.run",
          cli: "coder-studio ui run-command --command <command-id>",
          permissions: ["ui:command"],
        }),
      ])
    );
  });

  it("filters capabilities by permissions", () => {
    const capabilities = listAutomationCapabilities({
      permissions: ["workspace:read"],
    });

    expect(capabilities.map((capability) => capability.name)).toContain("workspace.list");
    expect(capabilities.map((capability) => capability.name)).not.toContain("git.status");
    expect(capabilities.map((capability) => capability.name)).not.toContain("memory.list");
    expect(
      listAutomationCapabilities({ permissions: ["memory:read"] }).map(
        (capability) => capability.name
      )
    ).toEqual(["memory.list", "memory.search", "memory.get"]);
    expect(
      listAutomationCapabilities({ permissions: ["memory:write"] }).map(
        (capability) => capability.name
      )
    ).toEqual(["memory.add", "memory.update", "memory.delete"]);
  });
});
