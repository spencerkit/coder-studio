export const WINDOWS_COMMAND_LINE_LIMIT = 8191;

const COMMAND_LINE_SAFETY_MARGIN = 256;
const UNIX_ARGV_SOFT_LIMIT = 100_000;

export interface HeadlessSpawnCommand {
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}

export function estimateCommandLineLength(argv: string[]): number {
  let length = 0;
  for (const arg of argv) {
    length += arg.length + 1;
    if (/[\s"]/.test(arg)) {
      length += 2;
    }
  }
  return length;
}

export function shouldDeliverPromptViaStdin(
  argv: string[],
  platform: NodeJS.Platform = process.platform
): boolean {
  const estimated = estimateCommandLineLength(argv);
  if (platform === "win32") {
    return estimated > WINDOWS_COMMAND_LINE_LIMIT - COMMAND_LINE_SAFETY_MARGIN;
  }
  return estimated > UNIX_ARGV_SOFT_LIMIT;
}

export function prepareHeadlessSpawnCommand(
  command: HeadlessSpawnCommand,
  prompt: string,
  platform: NodeJS.Platform = process.platform
): HeadlessSpawnCommand {
  if (!shouldDeliverPromptViaStdin(command.argv, platform)) {
    return command;
  }

  const promptIndex = command.argv.lastIndexOf(prompt);
  if (promptIndex < 0) {
    return command;
  }

  const argv = command.argv.slice(0, promptIndex).concat(command.argv.slice(promptIndex + 1));
  removePromptFlagWithoutValue(argv);

  return {
    ...command,
    argv,
    stdin: prompt,
  };
}

function removePromptFlagWithoutValue(argv: string[]): void {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--prompt") {
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("-")) {
      argv.splice(index, 1);
    }
    return;
  }
}
