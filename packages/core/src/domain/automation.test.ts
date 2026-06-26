import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildIdentifyResult,
  DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  listAutomationCapabilities,
  SCOPED_SESSION_AUTOMATION_PERMISSIONS,
} from "./automation.js";

describe("automation domain", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CODER_STUDIO_AUTOMATION_PERMISSIONS;
  });

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

  it("reads scoped automation permissions from env when present", () => {
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_AUTOMATION_PERMISSIONS: SCOPED_SESSION_AUTOMATION_PERMISSIONS.join(", "),
        },
      }).permissions
    ).toEqual(SCOPED_SESSION_AUTOMATION_PERMISSIONS);
  });

  it("treats an explicitly empty scoped permission env as authoritative and returns no permissions", () => {
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_AUTOMATION_PERMISSIONS: "",
        },
      }).permissions
    ).toEqual([]);
  });

  it("treats an invalid scoped permission env as authoritative and returns no permissions", () => {
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_AUTOMATION_PERMISSIONS: "invalid:permission, nope",
        },
      }).permissions
    ).toEqual([]);
  });

  it("treats mixed valid and invalid scoped permission env tokens as invalid", () => {
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_AUTOMATION_PERMISSIONS: "session:read,invalid:permission",
        },
      }).permissions
    ).toEqual([]);
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_AUTOMATION_PERMISSIONS: "invalid:permission,session:read",
        },
      }).permissions
    ).toEqual([]);
  });

  it("treats blank scoped permission env tokens as invalid", () => {
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_AUTOMATION_PERMISSIONS: "session:read,",
        },
      }).permissions
    ).toEqual([]);
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_AUTOMATION_PERMISSIONS: ",session:read",
        },
      }).permissions
    ).toEqual([]);
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_AUTOMATION_PERMISSIONS: "session:read,,git:read",
        },
      }).permissions
    ).toEqual([]);
    expect(
      buildIdentifyResult({
        env: {
          CODER_STUDIO: "1",
          CODER_STUDIO_AUTOMATION_PERMISSIONS: "session:read, ,git:read",
        },
      }).permissions
    ).toEqual([]);
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
      examples: ['coder-studio memory add --workspace ws_123 --type wiki --content "..." --json'],
    });
    expect(memoryAdd?.examples).toEqual([
      'coder-studio memory add --workspace ws_123 --type wiki --content "..." --json',
    ]);
    expect(memoryAdd?.inputSchema).toEqual({
      workspaceId: "string",
      type: "wiki | issue | todo | note",
      content: "string",
      status: "not_started | in_progress | pending_verification | completed optional",
    });
    expect(memoryAdd?.inputSchema).not.toHaveProperty("tags");
    expect(memoryUpdate?.inputSchema).toEqual({
      workspaceId: "string",
      id: "string",
      type: "wiki | issue | todo | note optional",
      content: "string optional",
      status: "not_started | in_progress | pending_verification | completed optional",
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
    expect(memoryExamples).toSatisfy((examples) =>
      examples.every((example) => !example.includes("--type project"))
    );
    expect(memoryAdd?.inputSchema.type).not.toContain("project_fact");
    expect(memoryUpdate?.inputSchema.type).not.toContain("project_fact");
    expect(memoryExamples).toSatisfy((examples) =>
      examples.every((example) => !example.includes("project_fact"))
    );
    expect(JSON.stringify(memoryCapabilities)).not.toContain("bugfix");
    expect(JSON.stringify(memoryCapabilities)).not.toContain(
      "feature | todo | bugfix | project | note"
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

  it("lists scoped capabilities without workspace.list while preserving session, terminal, git, memory, and ui actions", () => {
    const capabilities = listAutomationCapabilities({
      permissions: SCOPED_SESSION_AUTOMATION_PERMISSIONS,
    });
    const capabilityNames = capabilities.map((capability) => capability.name);

    expect(capabilityNames).not.toContain("workspace.list");
    expect(capabilityNames).toEqual(
      expect.arrayContaining([
        "session.list",
        "terminal.read",
        "git.status",
        "git.diff",
        "memory.list",
        "memory.search",
        "memory.get",
        "memory.add",
        "memory.update",
        "memory.delete",
        "ui.editor.openFile",
        "ui.editor.closeFile",
        "ui.browser.openUrl",
        "ui.browser.closeUrl",
        "ui.workspace.focus",
        "ui.panel.show",
        "ui.command.run",
      ])
    );
  });

  it("prints scoped capabilities in the cli without workspace.list", async () => {
    process.env.CODER_STUDIO_AUTOMATION_PERMISSIONS =
      SCOPED_SESSION_AUTOMATION_PERMISSIONS.join(", ");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { printCapabilities } = await import("../../../cli/src/automation-client.ts");

    printCapabilities({ json: true });

    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
      version: number;
      commands: Array<{ name: string }>;
    };

    expect(payload.version).toBe(1);
    expect(payload.commands.map((command) => command.name)).not.toContain("workspace.list");
    expect(payload.commands.map((command) => command.name)).toEqual(
      expect.arrayContaining([
        "session.list",
        "terminal.read",
        "git.status",
        "git.diff",
        "memory.list",
        "memory.search",
        "memory.get",
        "memory.add",
        "memory.update",
        "memory.delete",
        "ui.editor.openFile",
        "ui.command.run",
      ])
    );
  });

  it("prints no cli capabilities when the scoped permission env is present but invalid", async () => {
    process.env.CODER_STUDIO_AUTOMATION_PERMISSIONS = "invalid:permission, nope";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { printCapabilities } = await import("../../../cli/src/automation-client.ts");

    printCapabilities({ json: true });

    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
      version: number;
      commands: Array<{ name: string }>;
    };

    expect(payload.version).toBe(1);
    expect(payload.commands).toEqual([]);
  });

  it("prints no cli capabilities when the scoped permission env mixes valid and invalid tokens", async () => {
    process.env.CODER_STUDIO_AUTOMATION_PERMISSIONS = "session:read,invalid:permission";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { printCapabilities } = await import("../../../cli/src/automation-client.ts");

    printCapabilities({ json: true });

    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
      version: number;
      commands: Array<{ name: string }>;
    };

    expect(payload.version).toBe(1);
    expect(payload.commands).toEqual([]);
  });

  it("prints no cli capabilities when the scoped permission env includes blank tokens", async () => {
    process.env.CODER_STUDIO_AUTOMATION_PERMISSIONS = "session:read, ";

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { printCapabilities } = await import("../../../cli/src/automation-client.ts");

    printCapabilities({ json: true });

    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
      version: number;
      commands: Array<{ name: string }>;
    };

    expect(payload.version).toBe(1);
    expect(payload.commands).toEqual([]);
  });
});
