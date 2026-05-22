type CliCommand =
  | "serve"
  | "open"
  | "config"
  | "stop"
  | "status"
  | "logs"
  | "help"
  | "version"
  | "auth";
type AuthCommand = "ban-list" | "unblock";

export const RUNTIME_CONFIG_ERROR =
  "Host, port, state-dir, password, and auth settings must be configured via the config command";

export interface CliArgs {
  foreground?: boolean;
  restart?: boolean;
  command?: CliCommand;
  tail?: number;
  errorsOnly?: boolean;
  authCommand?: AuthCommand;
  configHelp?: boolean;
  port?: number;
  host?: string;
  stateDir?: string;
  password?: string;
  noAuth?: boolean;
  ip?: string;
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
      case "status":
      case "logs":
      case "version":
      case "auth":
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

  return args;
}
