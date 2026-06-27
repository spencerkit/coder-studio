import { pathToFileURL } from "node:url";
import { callCoderStudioCommand } from "./automation-command-client.js";

type SupportedOp =
  | "memory.list"
  | "memory.search"
  | "memory.get"
  | "memory.create"
  | "memory.update"
  | "memory.delete"
  | "session.activity.record"
  | "session.activity.list"
  | "canvas.list"
  | "canvas.create"
  | "canvas.update"
  | "canvas.render"
  | "ui.open-file"
  | "ui.close-file"
  | "ui.open-url"
  | "ui.close-url"
  | "ui.open-canvas";

type CanvasArtifactType = "architecture_canvas" | "report_canvas";

interface SessionEnv {
  apiUrl: string;
  workspaceId?: string;
  sessionId?: string;
}

interface ParsedEntryCommand {
  op: string;
  args: Record<string, unknown>;
  json: boolean;
}

function readRequiredEnv(name: "CODER_STUDIO_API_URL" | "CODER_STUDIO_WORKSPACE_ID"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Coder Studio automation is not available in this session. Missing ${name}.`);
  }

  return value;
}

function readSessionEnv(): SessionEnv {
  return {
    apiUrl: readRequiredEnv("CODER_STUDIO_API_URL"),
    workspaceId: process.env.CODER_STUDIO_WORKSPACE_ID?.trim() || undefined,
    sessionId: process.env.CODER_STUDIO_SESSION_ID?.trim() || undefined,
  };
}

function readRequiredWorkspaceId(env: SessionEnv): string {
  if (!env.workspaceId) {
    throw new Error(
      "Coder Studio automation is not available in this session. Missing CODER_STUDIO_WORKSPACE_ID."
    );
  }

  return env.workspaceId;
}

function readOptionValue(argv: string[], index: number, label: string): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing ${label} value`);
  }

  return value;
}

function readPositiveIntegerOption(argv: string[], index: number, label: string): number {
  const value = readOptionValue(argv, index, label);
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`Invalid ${label} number`);
  }

  return Number(value);
}

function parseJsonOption(label: string, value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function normalizeCanvasArtifactType(value: string): CanvasArtifactType {
  if (value !== "architecture_canvas" && value !== "report_canvas") {
    throw new Error("Invalid artifact-type value");
  }

  return value;
}

function parseJsonArrayOption(label: string, value: string): unknown[] {
  const parsed = parseJsonOption(label, value);
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} JSON: expected array`);
  }

  return parsed;
}

function parseJsonObjectOption(label: string, value: string): Record<string, unknown> {
  const parsed = parseJsonOption(label, value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid ${label} JSON: expected object`);
  }

  return parsed as Record<string, unknown>;
}

function ensureNoExtraPositionals(positionals: string[]): void {
  if (positionals.length > 0) {
    throw new Error(`Unknown argument: ${positionals[0]}`);
  }
}

function parseMemoryCommand(
  op: SupportedOp,
  argv: string[],
  workspaceId: string
): ParsedEntryCommand {
  let json = false;
  let query: string | undefined;
  let memoryId: string | undefined;
  let memoryType: string | undefined;
  let content: string | undefined;
  let status: string | undefined;
  let skillSlug: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }

    switch (arg) {
      case "--json":
        json = true;
        break;
      case "--type":
        memoryType = readOptionValue(argv, i + 1, "type");
        i += 1;
        break;
      case "--content":
        content = readOptionValue(argv, i + 1, "content");
        i += 1;
        break;
      case "--status":
        status = readOptionValue(argv, i + 1, "status");
        i += 1;
        break;
      case "--skill":
        skillSlug = readOptionValue(argv, i + 1, "skill");
        i += 1;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positionals.push(arg);
        break;
    }
  }

  if (op === "memory.list") {
    ensureNoExtraPositionals(positionals);
    return {
      op,
      json,
      args: {
        workspaceId,
        ...(memoryType !== undefined ? { type: memoryType } : {}),
      },
    };
  }

  if (op === "memory.search") {
    query = positionals[0];
    if (!query) {
      throw new Error("Missing query value");
    }
    ensureNoExtraPositionals(positionals.slice(1));
    return {
      op,
      json,
      args: {
        workspaceId,
        query,
        ...(memoryType !== undefined ? { type: memoryType } : {}),
      },
    };
  }

  if (op === "memory.get") {
    memoryId = positionals[0];
    if (!memoryId) {
      throw new Error("Missing memory id value");
    }
    ensureNoExtraPositionals(positionals.slice(1));
    return {
      op,
      json,
      args: { workspaceId, id: memoryId },
    };
  }

  if (op === "memory.create") {
    ensureNoExtraPositionals(positionals);
    if (!memoryType) {
      throw new Error("Missing type value");
    }
    if (!content) {
      throw new Error("Missing content value");
    }

    return {
      op,
      json,
      args: {
        workspaceId,
        type: memoryType,
        content,
        ...(status !== undefined ? { status } : {}),
        ...(skillSlug !== undefined ? { sourceHint: { skillSlug } } : {}),
      },
    };
  }

  if (op === "memory.update") {
    memoryId = positionals[0];
    if (!memoryId) {
      throw new Error("Missing memory id value");
    }
    ensureNoExtraPositionals(positionals.slice(1));
    return {
      op,
      json,
      args: {
        workspaceId,
        id: memoryId,
        ...(memoryType !== undefined ? { type: memoryType } : {}),
        ...(content !== undefined ? { content } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    };
  }

  memoryId = positionals[0];
  if (!memoryId) {
    throw new Error("Missing memory id value");
  }
  ensureNoExtraPositionals(positionals.slice(1));
  return {
    op,
    json,
    args: { workspaceId, id: memoryId },
  };
}

function parseCanvasCommand(
  op: SupportedOp,
  argv: string[],
  workspaceId: string
): ParsedEntryCommand {
  let json = false;
  let canvasId: string | undefined;
  let sourcePath: string | undefined;
  let kind: CanvasArtifactType | undefined;
  let title: string | undefined;
  let documentJson: string | undefined;
  let openInEditor = false;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }

    switch (arg) {
      case "--json":
        json = true;
        break;
      case "--canvas":
      case "--canvas-id":
        canvasId = readOptionValue(argv, i + 1, "canvas");
        i += 1;
        break;
      case "--source-path":
        sourcePath = readOptionValue(argv, i + 1, "source-path");
        i += 1;
        break;
      case "--kind":
        kind = normalizeCanvasArtifactType(readOptionValue(argv, i + 1, "kind"));
        i += 1;
        break;
      case "--title":
        title = readOptionValue(argv, i + 1, "title");
        i += 1;
        break;
      case "--document-json":
        documentJson = readOptionValue(argv, i + 1, "document-json");
        i += 1;
        break;
      case "--open":
        openInEditor = true;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positionals.push(arg);
        break;
    }
  }

  ensureNoExtraPositionals(positionals);

  if (op === "canvas.list") {
    return {
      op,
      json,
      args: { workspaceId },
    };
  }

  if (op === "canvas.create") {
    if (!kind) {
      throw new Error("Missing kind value");
    }
    if (!title) {
      throw new Error("Missing title value");
    }
    if (!documentJson) {
      throw new Error("Missing document-json value");
    }

    return {
      op,
      json,
      args: {
        workspaceId,
        kind,
        title,
        document: parseJsonOption("document-json", documentJson),
        ...(openInEditor ? { openInEditor: true } : {}),
      },
    };
  }

  if (op === "canvas.update") {
    if (!canvasId) {
      throw new Error("Missing canvas value");
    }
    if (!documentJson) {
      throw new Error("Missing document-json value");
    }

    return {
      op,
      json,
      args: {
        workspaceId,
        canvasId,
        ...(title !== undefined ? { title } : {}),
        document: parseJsonOption("document-json", documentJson),
      },
    };
  }

  if (!canvasId && !sourcePath) {
    throw new Error("Missing canvas or source-path value");
  }

  return {
    op,
    json,
    args: {
      workspaceId,
      ...(canvasId !== undefined ? { canvasId } : {}),
      ...(sourcePath !== undefined ? { sourcePath } : {}),
    },
  };
}

function parseUiCommand(op: SupportedOp, argv: string[], workspaceId: string): ParsedEntryCommand {
  let json = false;
  let path: string | undefined;
  let url: string | undefined;
  let line: number | undefined;
  let column: number | undefined;
  let canvasId: string | undefined;
  let title: string | undefined;
  let artifactType: CanvasArtifactType | undefined;
  let sourcePath: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }

    switch (arg) {
      case "--json":
        json = true;
        break;
      case "--path":
        path = readOptionValue(argv, i + 1, "path");
        i += 1;
        break;
      case "--url":
        url = readOptionValue(argv, i + 1, "url");
        i += 1;
        break;
      case "--line":
        line = readPositiveIntegerOption(argv, i + 1, "line");
        i += 1;
        break;
      case "--column":
        column = readPositiveIntegerOption(argv, i + 1, "column");
        i += 1;
        break;
      case "--canvas":
      case "--canvas-id":
        canvasId = readOptionValue(argv, i + 1, "canvas");
        i += 1;
        break;
      case "--title":
        title = readOptionValue(argv, i + 1, "title");
        i += 1;
        break;
      case "--artifact-type":
        artifactType = normalizeCanvasArtifactType(readOptionValue(argv, i + 1, "artifact-type"));
        i += 1;
        break;
      case "--source-path":
        sourcePath = readOptionValue(argv, i + 1, "source-path");
        i += 1;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positionals.push(arg);
        break;
    }
  }

  ensureNoExtraPositionals(positionals);

  if (op === "ui.open-file") {
    if (!path) {
      throw new Error("Missing path value");
    }
    return {
      op: "uiAction.dispatch",
      json,
      args: {
        workspaceId,
        intent: {
          type: "editor.openFile",
          workspaceId,
          path,
          ...(line !== undefined ? { line } : {}),
          ...(column !== undefined ? { column } : {}),
        },
        source: { kind: "agent" },
      },
    };
  }

  if (op === "ui.close-file") {
    if (!path) {
      throw new Error("Missing path value");
    }
    return {
      op: "uiAction.dispatch",
      json,
      args: {
        workspaceId,
        intent: {
          type: "editor.closeFile",
          workspaceId,
          path,
        },
        source: { kind: "agent" },
      },
    };
  }

  if (op === "ui.open-url") {
    if (!url) {
      throw new Error("Missing url value");
    }
    return {
      op: "uiAction.dispatch",
      json,
      args: {
        workspaceId,
        intent: {
          type: "browser.openUrl",
          workspaceId,
          url,
        },
        source: { kind: "agent" },
      },
    };
  }

  if (op === "ui.close-url") {
    if (!url) {
      throw new Error("Missing url value");
    }
    return {
      op: "uiAction.dispatch",
      json,
      args: {
        workspaceId,
        intent: {
          type: "browser.closeUrl",
          workspaceId,
          url,
        },
        source: { kind: "agent" },
      },
    };
  }

  if (!canvasId) {
    throw new Error("Missing canvas value");
  }

  return {
    op: "uiAction.dispatch",
    json,
    args: {
      workspaceId,
      intent: {
        type: "canvas.open",
        workspaceId,
        canvasId,
        ...(title !== undefined ? { title } : {}),
        ...(artifactType !== undefined ? { artifactType } : {}),
        ...(sourcePath !== undefined ? { sourcePath } : {}),
      },
      source: { kind: "agent" },
    },
  };
}

function readRequiredSessionId(explicitSessionId: string | undefined, env: SessionEnv): string {
  const sessionId = explicitSessionId ?? env.sessionId;
  if (!sessionId) {
    throw new Error("Missing CODER_STUDIO_SESSION_ID or --session value");
  }

  return sessionId;
}

function parseSessionActivityCommand(
  op: SupportedOp,
  argv: string[],
  env: SessionEnv
): ParsedEntryCommand {
  let json = false;
  let sessionId: string | undefined;
  let kind: string | undefined;
  let phase: string | undefined;
  let title: string | undefined;
  let summary: string | undefined;
  let status: string | undefined;
  let command: string | undefined;
  let filesJson: string | undefined;
  let payloadJson: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }

    switch (arg) {
      case "--json":
        json = true;
        break;
      case "--session":
      case "--session-id":
        sessionId = readOptionValue(argv, i + 1, "session");
        i += 1;
        break;
      case "--kind":
        kind = readOptionValue(argv, i + 1, "kind");
        i += 1;
        break;
      case "--phase":
        phase = readOptionValue(argv, i + 1, "phase");
        i += 1;
        break;
      case "--title":
        title = readOptionValue(argv, i + 1, "title");
        i += 1;
        break;
      case "--summary":
        summary = readOptionValue(argv, i + 1, "summary");
        i += 1;
        break;
      case "--status":
        status = readOptionValue(argv, i + 1, "status");
        i += 1;
        break;
      case "--command":
        command = readOptionValue(argv, i + 1, "command");
        i += 1;
        break;
      case "--files":
        filesJson = readOptionValue(argv, i + 1, "files");
        i += 1;
        break;
      case "--payload-json":
        payloadJson = readOptionValue(argv, i + 1, "payload-json");
        i += 1;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positionals.push(arg);
        break;
    }
  }

  ensureNoExtraPositionals(positionals);

  if (op === "session.activity.list") {
    return {
      op,
      json,
      args: {
        sessionId: readRequiredSessionId(sessionId, env),
      },
    };
  }

  if (!kind) {
    throw new Error("Missing kind value");
  }
  if (!title) {
    throw new Error("Missing title value");
  }

  return {
    op,
    json,
    args: {
      sessionId: readRequiredSessionId(sessionId, env),
      kind,
      ...(phase !== undefined ? { phase } : {}),
      title,
      ...(summary !== undefined ? { summary } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(command !== undefined ? { command } : {}),
      ...(filesJson !== undefined ? { files: parseJsonArrayOption("files", filesJson) } : {}),
      ...(payloadJson !== undefined
        ? { payload: parseJsonObjectOption("payload-json", payloadJson) }
        : {}),
    },
  };
}

function parseCommand(
  opValue: string | undefined,
  argv: string[],
  env: SessionEnv
): ParsedEntryCommand {
  if (!opValue) {
    throw new Error("Missing automation op");
  }

  const op = opValue as SupportedOp;
  switch (op) {
    case "memory.list":
    case "memory.search":
    case "memory.get":
    case "memory.create":
    case "memory.update":
    case "memory.delete":
      return parseMemoryCommand(op, argv, readRequiredWorkspaceId(env));
    case "session.activity.record":
    case "session.activity.list":
      return parseSessionActivityCommand(op, argv, env);
    case "canvas.list":
    case "canvas.create":
    case "canvas.update":
    case "canvas.render":
      return parseCanvasCommand(op, argv, readRequiredWorkspaceId(env));
    case "ui.open-file":
    case "ui.close-file":
    case "ui.open-url":
    case "ui.close-url":
    case "ui.open-canvas":
      return parseUiCommand(op, argv, readRequiredWorkspaceId(env));
    default:
      throw new Error(`Unsupported automation op: ${opValue}`);
  }
}

function printCommandResult(result: unknown, json: boolean): void {
  if (
    !json &&
    typeof result === "object" &&
    result !== null &&
    "text" in result &&
    typeof (result as { text?: unknown }).text === "string"
  ) {
    console.log((result as { text: string }).text);
    return;
  }

  if (
    !json &&
    typeof result === "object" &&
    result !== null &&
    "diff" in result &&
    typeof (result as { diff?: unknown }).diff === "string"
  ) {
    console.log((result as { diff: string }).diff);
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const env = readSessionEnv();
  const [op, ...rest] = argv;
  const parsed = parseCommand(op, rest, env);
  const result = await callCoderStudioCommand({
    apiUrl: env.apiUrl,
    resolveStrategy: "session",
    op: parsed.op,
    args: parsed.args,
  });

  printCommandResult(result, parsed.json);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("CLI error:", message);
    process.exit(1);
  });
}
