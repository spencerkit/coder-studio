type CliCommand =
  | "serve"
  | "open"
  | "config"
  | "stop"
  | "status"
  | "logs"
  | "help"
  | "version"
  | "auth"
  | "identify"
  | "capabilities"
  | "workspace"
  | "session"
  | "terminal"
  | "git"
  | "ui"
  | "memory"
  | "canvas";
type AuthCommand = "ban-list" | "unblock";
type WorkspaceCommand = "list";
type SessionCommand = "list";
type TerminalCommand = "read";
type GitCommand = "status" | "diff";
type CanvasCommand = "list" | "create" | "update" | "render";
type UiCommand =
  | "open-file"
  | "close-file"
  | "open-url"
  | "close-url"
  | "open-canvas"
  | "show-panel"
  | "focus-workspace"
  | "run-command";
type MemoryCommand = "list" | "get" | "search" | "add" | "update" | "delete";

export const RUNTIME_CONFIG_ERROR =
  "Host, port, state-dir, password, and auth settings must be configured via the config command";

const AUTOMATION_COMMANDS = [
  "workspace",
  "session",
  "terminal",
  "git",
  "ui",
  "memory",
  "canvas",
] as const;

export interface CliArgs {
  foreground?: boolean;
  restart?: boolean;
  command?: CliCommand;
  tail?: number;
  errorsOnly?: boolean;
  authCommand?: AuthCommand;
  workspaceCommand?: WorkspaceCommand;
  sessionCommand?: SessionCommand;
  terminalCommand?: TerminalCommand;
  gitCommand?: GitCommand;
  uiCommand?: UiCommand;
  memoryCommand?: MemoryCommand;
  canvasCommand?: CanvasCommand;
  configHelp?: boolean;
  port?: number;
  host?: string;
  stateDir?: string;
  password?: string;
  noAuth?: boolean;
  ip?: string;
  json?: boolean;
  workspaceId?: string;
  canvasId?: string;
  terminalId?: string;
  bytes?: number;
  path?: string;
  sourcePath?: string;
  url?: string;
  panel?: string;
  uiCommandId?: string;
  line?: number;
  column?: number;
  staged?: boolean;
  apiUrl?: string;
  memoryId?: string;
  memoryType?: string;
  memoryStatus?: string;
  query?: string;
  content?: string;
  tags?: string[];
  skillSlug?: string;
  kind?: "architecture_canvas" | "report_canvas";
  title?: string;
  documentJson?: string;
  openInEditor?: boolean;
}

function getActiveCommand(args: CliArgs): CliCommand {
  return args.command ?? "serve";
}

function isAutomationCommand(command: CliCommand): boolean {
  return (AUTOMATION_COMMANDS as readonly string[]).includes(command);
}

function clearConfigArgs(args: CliArgs): void {
  delete args.configHelp;
  delete args.port;
  delete args.host;
  delete args.stateDir;
  delete args.password;
  delete args.noAuth;
}

function clearAuthArgs(args: CliArgs): void {
  delete args.authCommand;
  delete args.ip;
}

function clearMemoryArgs(args: CliArgs): void {
  delete args.memoryId;
  delete args.memoryType;
  delete args.memoryStatus;
  delete args.query;
  delete args.content;
  delete args.tags;
  delete args.skillSlug;
}

function clearCanvasArgs(args: CliArgs): void {
  delete args.canvasId;
  delete args.sourcePath;
  delete args.kind;
  delete args.title;
  delete args.documentJson;
  delete args.openInEditor;
}

function clearAutomationArgs(args: CliArgs): void {
  delete args.workspaceCommand;
  delete args.sessionCommand;
  delete args.terminalCommand;
  delete args.gitCommand;
  delete args.uiCommand;
  delete args.memoryCommand;
  delete args.canvasCommand;
  delete args.workspaceId;
  delete args.canvasId;
  delete args.terminalId;
  delete args.bytes;
  delete args.path;
  delete args.sourcePath;
  delete args.url;
  delete args.panel;
  delete args.uiCommandId;
  delete args.line;
  delete args.column;
  delete args.staged;
  delete args.apiUrl;
  delete args.kind;
  delete args.title;
  delete args.documentJson;
  delete args.openInEditor;
  clearMemoryArgs(args);
}

function clearLogsArgs(args: CliArgs): void {
  delete args.tail;
  delete args.errorsOnly;
}

function setCommand(args: CliArgs, command: CliCommand): void {
  const previousCommand = args.command;
  const isAutomation = isAutomationCommand(command);
  const wasAutomation = previousCommand !== undefined && isAutomationCommand(previousCommand);

  if (command !== "config") {
    clearConfigArgs(args);
  }

  if (command !== "auth") {
    clearAuthArgs(args);
  }

  if (command !== "logs") {
    clearLogsArgs(args);
  }

  if (!isAutomation || (wasAutomation && previousCommand !== command)) {
    clearAutomationArgs(args);
  } else if (command !== "memory") {
    clearMemoryArgs(args);
  }

  if (command !== "identify" && command !== "capabilities" && !isAutomation) {
    delete args.json;
  }

  if (command !== "serve") {
    delete args.foreground;
  }

  if (command !== "serve" && command !== "open") {
    delete args.restart;
  }

  args.command = command;
}

function throwUnknownOption(option: string): never {
  throw new Error(`Unknown option: ${option}`);
}

function throwUnknownArgument(argument: string): never {
  throw new Error(`Unknown argument: ${argument}`);
}

function ensureConfigContext(args: CliArgs, option: string): void {
  const command = getActiveCommand(args);

  if (command === "config") {
    return;
  }

  if (command === "serve") {
    throw new Error(RUNTIME_CONFIG_ERROR);
  }

  throwUnknownOption(option);
}

function readOptionValue(argv: string[], index: number, label: string): string {
  const value = argv[index];

  if (value === undefined) {
    throw new Error(`Missing ${label} value`);
  }

  return value;
}

function readPositiveIntegerOption(argv: string[], index: number, label: string): number {
  const value = readOptionValue(argv, index, label);
  if (!/^[1-9]\d*$/u.test(value)) {
    throw new Error(`Invalid ${label} number`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid ${label} number`);
  }

  return parsed;
}

function memoryCommandSupportsStatus(command: MemoryCommand): boolean {
  return command === "add" || command === "update";
}

function setMemoryCommand(args: CliArgs, command: MemoryCommand): void {
  const isSwitchingSubcommands = args.memoryCommand !== undefined;
  if (isSwitchingSubcommands) {
    clearMemoryArgs(args);
  }

  args.memoryCommand = command;

  if (args.memoryStatus !== undefined && !memoryCommandSupportsStatus(command)) {
    throwUnknownOption("--status");
  }
}

function setCanvasCommand(args: CliArgs, command: CanvasCommand): void {
  const isSwitchingSubcommands = args.canvasCommand !== undefined;
  if (isSwitchingSubcommands) {
    clearCanvasArgs(args);
  }

  args.canvasCommand = command;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }

    switch (arg) {
      case "serve":
      case "open":
      case "config":
      case "stop":
      case "logs":
      case "version":
      case "auth":
      case "identify":
      case "capabilities":
      case "workspace":
      case "session":
      case "terminal":
      case "git":
      case "ui":
      case "memory":
      case "canvas":
        setCommand(args, arg);
        break;

      case "status":
        if (getActiveCommand(args) === "git") {
          args.gitCommand = arg;
          break;
        }

        setCommand(args, arg);
        break;

      case "server":
        setCommand(args, "serve");
        break;

      case "help":
      case "--help":
      case "-h":
        if (args.command === "config") {
          args.configHelp = true;
          break;
        }

        setCommand(args, "help");
        break;

      case "--version":
      case "-v":
        setCommand(args, "version");
        break;

      case "--foreground":
        if (getActiveCommand(args) !== "serve") {
          throwUnknownOption(arg);
        }

        args.foreground = true;
        break;

      case "--restart": {
        const command = getActiveCommand(args);

        if (command !== "serve" && command !== "open") {
          throwUnknownOption(arg);
        }

        args.restart = true;
        break;
      }

      case "--tail": {
        if (getActiveCommand(args) !== "logs") {
          throwUnknownOption(arg);
        }

        const tailValue = readOptionValue(argv, i + 1, "tail");
        if (!/^[1-9]\d*$/u.test(tailValue)) {
          throw new Error("Invalid tail number");
        }

        const tail = Number(tailValue);
        if (!Number.isSafeInteger(tail)) {
          throw new Error("Invalid tail number");
        }

        args.tail = tail;
        i += 1;
        break;
      }

      case "--errors-only":
        if (getActiveCommand(args) !== "logs") {
          throwUnknownOption(arg);
        }

        args.errorsOnly = true;
        break;

      case "--json": {
        const command = getActiveCommand(args);

        if (command !== "identify" && command !== "capabilities" && !isAutomationCommand(command)) {
          throwUnknownOption(arg);
        }

        args.json = true;
        break;
      }

      case "--workspace":
      case "--workspace-id": {
        const command = getActiveCommand(args);
        if (
          command !== "session" &&
          command !== "git" &&
          command !== "ui" &&
          command !== "memory" &&
          command !== "canvas"
        ) {
          throwUnknownOption(arg);
        }

        args.workspaceId = readOptionValue(argv, i + 1, "workspace");
        i += 1;
        break;
      }

      case "--terminal":
      case "--terminal-id": {
        if (getActiveCommand(args) !== "terminal") {
          throwUnknownOption(arg);
        }

        args.terminalId = readOptionValue(argv, i + 1, "terminal");
        i += 1;
        break;
      }

      case "--bytes": {
        if (getActiveCommand(args) !== "terminal") {
          throwUnknownOption(arg);
        }

        args.bytes = readPositiveIntegerOption(argv, i + 1, "bytes");
        i += 1;
        break;
      }

      case "--path": {
        const command = getActiveCommand(args);
        if (
          (command !== "git" || args.gitCommand !== "diff") &&
          (command !== "ui" || (args.uiCommand !== "open-file" && args.uiCommand !== "close-file"))
        ) {
          throwUnknownOption(arg);
        }

        args.path = readOptionValue(argv, i + 1, "path");
        i += 1;
        break;
      }

      case "--url": {
        if (
          getActiveCommand(args) !== "ui" ||
          (args.uiCommand !== "open-url" && args.uiCommand !== "close-url")
        ) {
          throwUnknownOption(arg);
        }

        args.url = readOptionValue(argv, i + 1, "url");
        i += 1;
        break;
      }

      case "--panel": {
        if (getActiveCommand(args) !== "ui" || args.uiCommand !== "show-panel") {
          throwUnknownOption(arg);
        }

        args.panel = readOptionValue(argv, i + 1, "panel");
        i += 1;
        break;
      }

      case "--command": {
        if (getActiveCommand(args) !== "ui" || args.uiCommand !== "run-command") {
          throwUnknownOption(arg);
        }

        args.uiCommandId = readOptionValue(argv, i + 1, "command");
        i += 1;
        break;
      }

      case "--line": {
        if (getActiveCommand(args) !== "ui" || args.uiCommand !== "open-file") {
          throwUnknownOption(arg);
        }

        args.line = readPositiveIntegerOption(argv, i + 1, "line");
        i += 1;
        break;
      }

      case "--column": {
        if (getActiveCommand(args) !== "ui" || args.uiCommand !== "open-file") {
          throwUnknownOption(arg);
        }

        args.column = readPositiveIntegerOption(argv, i + 1, "column");
        i += 1;
        break;
      }

      case "--staged": {
        if (getActiveCommand(args) !== "git" || args.gitCommand !== "diff") {
          throwUnknownOption(arg);
        }

        args.staged = true;
        break;
      }

      case "--api-url": {
        const command = getActiveCommand(args);
        if (!isAutomationCommand(command)) {
          throwUnknownOption(arg);
        }

        args.apiUrl = readOptionValue(argv, i + 1, "api-url");
        i += 1;
        break;
      }

      case "--type":
        if (getActiveCommand(args) !== "memory") {
          throwUnknownOption(arg);
        }

        args.memoryType = readOptionValue(argv, i + 1, "type");
        i += 1;
        break;

      case "--status":
        if (
          getActiveCommand(args) !== "memory" ||
          (args.memoryCommand !== undefined && !memoryCommandSupportsStatus(args.memoryCommand))
        ) {
          throwUnknownOption(arg);
        }

        args.memoryStatus = readOptionValue(argv, i + 1, "status");
        i += 1;
        break;

      case "--content":
        if (getActiveCommand(args) !== "memory") {
          throwUnknownOption(arg);
        }

        args.content = readOptionValue(argv, i + 1, "content");
        i += 1;
        break;

      case "--tag":
        if (getActiveCommand(args) !== "memory") {
          throwUnknownOption(arg);
        }

        args.tags = [...(args.tags ?? []), readOptionValue(argv, i + 1, "tag")];
        i += 1;
        break;

      case "--skill":
        if (getActiveCommand(args) !== "memory") {
          throwUnknownOption(arg);
        }

        args.skillSlug = readOptionValue(argv, i + 1, "skill");
        i += 1;
        break;

      case "--kind":
        if (getActiveCommand(args) !== "canvas" || args.canvasCommand !== "create") {
          throwUnknownOption(arg);
        }

        {
          const value = readOptionValue(argv, i + 1, "kind");
          if (value !== "architecture_canvas" && value !== "report_canvas") {
            throw new Error("Invalid kind value");
          }
          args.kind = value;
        }
        i += 1;
        break;

      case "--title":
        if (
          getActiveCommand(args) !== "canvas" ||
          (args.canvasCommand !== "create" && args.canvasCommand !== "update")
        ) {
          throwUnknownOption(arg);
        }

        args.title = readOptionValue(argv, i + 1, "title");
        i += 1;
        break;

      case "--document-json":
        if (
          getActiveCommand(args) !== "canvas" ||
          (args.canvasCommand !== "create" && args.canvasCommand !== "update")
        ) {
          throwUnknownOption(arg);
        }

        args.documentJson = readOptionValue(argv, i + 1, "document-json");
        i += 1;
        break;

      case "--canvas":
      case "--canvas-id":
        if (getActiveCommand(args) === "ui" && args.uiCommand === "open-canvas") {
          args.canvasId = readOptionValue(argv, i + 1, "canvas");
          i += 1;
          break;
        }

        if (
          getActiveCommand(args) !== "canvas" ||
          (args.canvasCommand !== "update" && args.canvasCommand !== "render")
        ) {
          throwUnknownOption(arg);
        }

        args.canvasId = readOptionValue(argv, i + 1, "canvas");
        i += 1;
        break;

      case "--source-path":
        if (getActiveCommand(args) !== "canvas" || args.canvasCommand !== "render") {
          throwUnknownOption(arg);
        }

        args.sourcePath = readOptionValue(argv, i + 1, "source-path");
        i += 1;
        break;

      case "--open":
        if (getActiveCommand(args) !== "canvas" || args.canvasCommand !== "create") {
          throwUnknownOption(arg);
        }

        args.openInEditor = true;
        break;

      case "--port":
      case "-p": {
        ensureConfigContext(args, arg);
        const portValue = readOptionValue(argv, i + 1, "port");
        const port = Number.parseInt(portValue, 10);

        if (Number.isNaN(port)) {
          throw new Error("Invalid port number");
        }

        args.port = port;
        i += 1;
        break;
      }

      case "--host":
        ensureConfigContext(args, arg);
        args.host = readOptionValue(argv, i + 1, "host");
        i += 1;
        break;

      case "--state-dir":
      case "--data-dir":
      case "-d":
        ensureConfigContext(args, arg);
        args.stateDir = readOptionValue(argv, i + 1, "state-dir");
        i += 1;
        break;

      case "--password":
        ensureConfigContext(args, arg);
        args.password = readOptionValue(argv, i + 1, "password");
        i += 1;
        break;

      case "--no-auth":
        if (getActiveCommand(args) === "serve") {
          throw new Error(RUNTIME_CONFIG_ERROR);
        }

        throwUnknownOption(arg);

      case "ban-list":
      case "unblock":
        if (getActiveCommand(args) !== "auth") {
          throwUnknownArgument(arg);
        }

        args.authCommand = arg;
        break;

      case "list": {
        const command = getActiveCommand(args);
        if (command === "workspace") {
          args.workspaceCommand = arg;
          break;
        }
        if (command === "session") {
          args.sessionCommand = arg;
          break;
        }
        if (command === "memory") {
          setMemoryCommand(args, arg);
          break;
        }
        if (command === "canvas") {
          setCanvasCommand(args, arg);
          break;
        }

        throwUnknownArgument(arg);
      }

      case "create":
      case "render":
        if (getActiveCommand(args) !== "canvas") {
          throwUnknownArgument(arg);
        }

        setCanvasCommand(args, arg);
        break;

      case "get":
      case "search":
      case "add":
      case "update":
      case "delete":
        if (getActiveCommand(args) === "canvas" && arg === "update") {
          setCanvasCommand(args, arg);
          break;
        }

        if (getActiveCommand(args) !== "memory") {
          throwUnknownArgument(arg);
        }

        setMemoryCommand(args, arg);
        break;

      case "read":
        if (getActiveCommand(args) !== "terminal") {
          throwUnknownArgument(arg);
        }

        args.terminalCommand = arg;
        break;

      case "diff":
        if (getActiveCommand(args) !== "git") {
          throwUnknownArgument(arg);
        }

        args.gitCommand = arg;
        break;

      case "open-file":
      case "close-file":
      case "open-url":
      case "close-url":
      case "open-canvas":
      case "show-panel":
      case "focus-workspace":
      case "run-command":
        if (getActiveCommand(args) !== "ui") {
          throwUnknownArgument(arg);
        }

        args.uiCommand = arg;
        break;

      case "--ip":
        if (getActiveCommand(args) !== "auth" || args.authCommand !== "unblock") {
          throwUnknownOption(arg);
        }

        args.ip = readOptionValue(argv, i + 1, "ip");
        i += 1;
        break;

      default:
        if (arg.startsWith("-")) {
          throwUnknownOption(arg);
        }

        if (getActiveCommand(args) === "memory") {
          if (args.memoryCommand === "search" && args.query === undefined) {
            args.query = arg;
            break;
          }

          if (
            (args.memoryCommand === "get" ||
              args.memoryCommand === "update" ||
              args.memoryCommand === "delete") &&
            args.memoryId === undefined
          ) {
            args.memoryId = arg;
            break;
          }
        }

        throwUnknownArgument(arg);
    }
  }

  if (args.command === undefined) {
    args.command = "serve";
  }

  if (args.command === "auth") {
    if (args.authCommand === undefined) {
      throw new Error("Missing auth subcommand");
    }

    if (args.authCommand === "unblock" && args.ip === undefined) {
      throw new Error("Missing ip value");
    }
  }

  if (args.command === "workspace") {
    if (args.workspaceCommand === undefined) {
      throw new Error("Missing workspace subcommand");
    }
  }

  if (args.command === "session") {
    if (args.sessionCommand === undefined) {
      throw new Error("Missing session subcommand");
    }

    if (args.sessionCommand === "list" && args.workspaceId === undefined) {
      throw new Error("Missing workspace value");
    }
  }

  if (args.command === "terminal") {
    if (args.terminalCommand === undefined) {
      throw new Error("Missing terminal subcommand");
    }

    if (args.terminalCommand === "read" && args.terminalId === undefined) {
      throw new Error("Missing terminal value");
    }
  }

  if (args.command === "git") {
    if (args.gitCommand === undefined) {
      throw new Error("Missing git subcommand");
    }

    if (args.workspaceId === undefined) {
      throw new Error("Missing workspace value");
    }

    if (args.gitCommand === "diff" && args.path === undefined) {
      throw new Error("Missing path value");
    }
  }

  if (args.command === "ui") {
    if (args.uiCommand === undefined) {
      throw new Error("Missing ui subcommand");
    }

    if (
      (args.uiCommand === "open-file" || args.uiCommand === "close-file") &&
      args.path === undefined
    ) {
      throw new Error("Missing path value");
    }

    if (
      (args.uiCommand === "open-url" || args.uiCommand === "close-url") &&
      args.url === undefined
    ) {
      throw new Error("Missing url value");
    }

    if (args.uiCommand === "open-canvas" && args.canvasId === undefined) {
      throw new Error("Missing canvas value");
    }

    if (args.uiCommand === "show-panel" && args.panel === undefined) {
      throw new Error("Missing panel value");
    }

    if (args.uiCommand === "focus-workspace" && args.workspaceId === undefined) {
      throw new Error("Missing workspace value");
    }

    if (args.uiCommand === "run-command" && args.uiCommandId === undefined) {
      throw new Error("Missing command value");
    }
  }

  if (args.command === "memory") {
    if (args.memoryCommand === undefined) {
      throw new Error("Missing memory subcommand");
    }

    if (args.memoryStatus !== undefined && !memoryCommandSupportsStatus(args.memoryCommand)) {
      throwUnknownOption("--status");
    }

    if (
      (args.memoryCommand === "get" ||
        args.memoryCommand === "update" ||
        args.memoryCommand === "delete") &&
      args.memoryId === undefined
    ) {
      throw new Error("Missing memory id value");
    }

    if (args.memoryCommand === "search" && args.query === undefined) {
      throw new Error("Missing query value");
    }

    if (args.memoryCommand === "add") {
      if (args.memoryType === undefined) {
        throw new Error("Missing type value");
      }

      if (args.content === undefined) {
        throw new Error("Missing content value");
      }
    }
  }

  if (args.command === "canvas") {
    if (args.canvasCommand === undefined) {
      throw new Error("Missing canvas subcommand");
    }

    if (args.workspaceId === undefined) {
      throw new Error("Missing workspace value");
    }

    if (args.canvasCommand === "create") {
      if (args.kind === undefined) {
        throw new Error("Missing kind value");
      }

      if (args.title === undefined) {
        throw new Error("Missing title value");
      }

      if (args.documentJson === undefined) {
        throw new Error("Missing document-json value");
      }
    }

    if (args.canvasCommand === "update") {
      if (args.canvasId === undefined) {
        throw new Error("Missing canvas value");
      }

      if (args.documentJson === undefined) {
        throw new Error("Missing document-json value");
      }
    }

    if (
      args.canvasCommand === "render" &&
      args.canvasId === undefined &&
      args.sourcePath === undefined
    ) {
      throw new Error("Missing canvas or source-path value");
    }
  }

  return args;
}
