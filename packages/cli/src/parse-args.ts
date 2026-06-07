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
  | "git";
type AuthCommand = "ban-list" | "unblock";
type WorkspaceCommand = "list";
type SessionCommand = "list";
type TerminalCommand = "read";
type GitCommand = "status" | "diff";

export const RUNTIME_CONFIG_ERROR =
  "Host, port, state-dir, password, and auth settings must be configured via the config command";

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
  configHelp?: boolean;
  port?: number;
  host?: string;
  stateDir?: string;
  password?: string;
  noAuth?: boolean;
  ip?: string;
  json?: boolean;
  workspaceId?: string;
  terminalId?: string;
  bytes?: number;
  path?: string;
  staged?: boolean;
  apiUrl?: string;
}

function getActiveCommand(args: CliArgs): CliCommand {
  return args.command ?? "serve";
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

function clearAutomationArgs(args: CliArgs): void {
  delete args.workspaceCommand;
  delete args.sessionCommand;
  delete args.terminalCommand;
  delete args.gitCommand;
  delete args.workspaceId;
  delete args.terminalId;
  delete args.bytes;
  delete args.path;
  delete args.staged;
  delete args.apiUrl;
}

function clearLogsArgs(args: CliArgs): void {
  delete args.tail;
  delete args.errorsOnly;
}

function setCommand(args: CliArgs, command: CliCommand): void {
  if (command !== "config") {
    clearConfigArgs(args);
  }

  if (command !== "auth") {
    clearAuthArgs(args);
  }

  if (command !== "logs") {
    clearLogsArgs(args);
  }

  if (!["workspace", "session", "terminal", "git"].includes(command)) {
    clearAutomationArgs(args);
  }

  if (
    command !== "identify" &&
    command !== "capabilities" &&
    !["workspace", "session", "terminal", "git"].includes(command)
  ) {
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

        if (
          command !== "identify" &&
          command !== "capabilities" &&
          !["workspace", "session", "terminal", "git"].includes(command)
        ) {
          throwUnknownOption(arg);
        }

        args.json = true;
        break;
      }

      case "--workspace":
      case "--workspace-id": {
        const command = getActiveCommand(args);
        if (command !== "session" && command !== "git") {
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

        const bytesValue = readOptionValue(argv, i + 1, "bytes");
        if (!/^[1-9]\d*$/u.test(bytesValue)) {
          throw new Error("Invalid bytes number");
        }

        const bytes = Number(bytesValue);
        if (!Number.isSafeInteger(bytes)) {
          throw new Error("Invalid bytes number");
        }

        args.bytes = bytes;
        i += 1;
        break;
      }

      case "--path": {
        if (getActiveCommand(args) !== "git" || args.gitCommand !== "diff") {
          throwUnknownOption(arg);
        }

        args.path = readOptionValue(argv, i + 1, "path");
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
        if (!["workspace", "session", "terminal", "git"].includes(command)) {
          throwUnknownOption(arg);
        }

        args.apiUrl = readOptionValue(argv, i + 1, "api-url");
        i += 1;
        break;
      }

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

        throwUnknownArgument(arg);
      }

      case "read":
        if (getActiveCommand(args) !== "terminal") {
          throwUnknownArgument(arg);
        }

        args.terminalCommand = arg;
        break;

      case "status":
      case "diff":
        if (getActiveCommand(args) !== "git") {
          throwUnknownArgument(arg);
        }

        args.gitCommand = arg;
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

  return args;
}
