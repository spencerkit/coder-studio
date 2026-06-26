import { existsSync as fsExistsSync } from "node:fs";
import path from "node:path";
import type { TerminalProfile } from "@coder-studio/core";
import {
  type CommandAvailabilityCheck,
  checkCommandAvailable,
  getCommandLookupExecutable,
} from "../provider-runtime/command-check.js";
import { type CommandRunner, runCommandAsString } from "../provider-runtime/command-runner.js";
import { formatWslLabel } from "./wsl.js";

export interface DetectedTerminalProfile extends TerminalProfile {
  source: "detected";
  argv: string[];
  cwdRuntime: "native" | "wsl";
  wslDistro?: string;
}

export interface DetectTerminalProfilesInput {
  platform?: NodeJS.Platform;
  shellPath?: string;
  commandExists?: CommandAvailabilityCheck;
  runCommand?: CommandRunner;
  existsSync?: (file: string) => boolean;
}

export async function detectTerminalProfiles(
  input: DetectTerminalProfilesInput = {}
): Promise<DetectedTerminalProfile[]> {
  const platform = input.platform ?? process.platform;
  const commandExists =
    input.commandExists ??
    ((command: string) =>
      checkCommandAvailable(command, {
        platform,
        runCommand: input.runCommand,
        existsSync: input.existsSync,
      }));

  if (platform === "win32") {
    return detectWindowsProfiles({ ...input, platform, commandExists });
  }

  return detectPosixProfiles({ ...input, platform, commandExists });
}

async function detectWindowsProfiles(
  input: Required<Pick<DetectTerminalProfilesInput, "platform">> &
    Pick<DetectTerminalProfilesInput, "runCommand" | "existsSync"> & {
      commandExists: CommandAvailabilityCheck;
    }
): Promise<DetectedTerminalProfile[]> {
  const profiles: DetectedTerminalProfile[] = [];

  if (await input.commandExists("pwsh")) {
    profiles.push({
      id: "detected:win:pwsh",
      label: "PowerShell",
      source: "detected",
      runtime: "native",
      icon: "terminal",
      argv: ["pwsh"],
      cwdRuntime: "native",
    });
  }

  if (await input.commandExists("powershell")) {
    profiles.push({
      id: "detected:win:powershell",
      label: "Windows PowerShell",
      source: "detected",
      runtime: "native",
      icon: "terminal",
      argv: ["powershell"],
      cwdRuntime: "native",
    });
  }

  const cmdPath = firstNonEmpty(process.env.ComSpec, process.env.COMSPEC) ?? "cmd.exe";
  if (await input.commandExists(cmdPath)) {
    profiles.push({
      id: "detected:win:cmd",
      label: "Command Prompt",
      source: "detected",
      runtime: "native",
      icon: "terminal",
      argv: [cmdPath],
      cwdRuntime: "native",
    });
  }

  const gitBashPath = await resolveGitBashPath(input);
  if (gitBashPath) {
    profiles.push({
      id: "detected:win:git-bash",
      label: "Git Bash",
      source: "detected",
      runtime: "native",
      icon: "terminal",
      argv: [gitBashPath],
      cwdRuntime: "native",
    });
  }

  if (await input.commandExists("wsl")) {
    const distros = await listWslDistros(input.runCommand);
    for (const distro of distros) {
      profiles.push({
        id: `detected:win:wsl:${distro}`,
        label: formatWslLabel(distro),
        source: "detected",
        runtime: "wsl",
        icon: "terminal",
        argv: ["wsl.exe", "-d", distro],
        cwdRuntime: "wsl",
        wslDistro: distro,
      });
    }
  }

  return profiles;
}

async function resolveGitBashPath(
  input: Pick<DetectTerminalProfilesInput, "platform" | "runCommand" | "existsSync"> & {
    commandExists: CommandAvailabilityCheck;
  }
): Promise<string | null> {
  const resolvedPath = await resolveWindowsCommandPath("bash", input.runCommand);
  if (resolvedPath && isGitForWindowsBashPath(resolvedPath)) {
    return resolvedPath;
  }

  const installPath = resolveGitBashInstallPath(input.existsSync);
  if (installPath) {
    return installPath;
  }

  return null;
}

async function detectPosixProfiles(
  input: Required<Pick<DetectTerminalProfilesInput, "platform">> &
    Pick<DetectTerminalProfilesInput, "shellPath"> & {
      commandExists: CommandAvailabilityCheck;
    }
): Promise<DetectedTerminalProfile[]> {
  const profiles: DetectedTerminalProfile[] = [];
  const seenIds = new Set<string>();
  const shellPath = input.shellPath ?? process.env.SHELL;

  if (shellPath) {
    const shellName = basenameForPlatform(shellPath, input.platform);
    const currentProfile = buildPosixProfile(shellName, shellPath);
    pushIfUnique(profiles, seenIds, currentProfile);
  }

  for (const command of ["zsh", "bash", "fish", "pwsh"] as const) {
    if (!(await input.commandExists(command))) {
      continue;
    }

    pushIfUnique(profiles, seenIds, buildPosixProfile(command, command));
  }

  return profiles;
}

function buildPosixProfile(shellName: string, command: string): DetectedTerminalProfile {
  return {
    id: `detected:posix:${shellName}`,
    label: shellName,
    source: "detected",
    runtime: "native",
    icon: "terminal",
    argv: requiresInteractiveFlag(shellName) ? [command, "-i"] : [command],
    cwdRuntime: "native",
  };
}

function basenameForPlatform(filePath: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? path.win32.basename(filePath) : path.posix.basename(filePath);
}

function requiresInteractiveFlag(shellName: string): boolean {
  return shellName !== "pwsh" && shellName !== "powershell" && shellName !== "cmd.exe";
}

function pushIfUnique(
  profiles: DetectedTerminalProfile[],
  seenIds: Set<string>,
  profile: DetectedTerminalProfile
): void {
  if (seenIds.has(profile.id)) {
    return;
  }

  seenIds.add(profile.id);
  profiles.push(profile);
}

async function listWslDistros(runCommand?: CommandRunner): Promise<string[]> {
  const runner = runCommand ?? runCommandAsString;

  try {
    const { stdout } = await runner("wsl.exe", ["-l", "-q"], { windowsHide: true });
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

async function resolveWindowsCommandPath(
  command: string,
  runCommand?: CommandRunner
): Promise<string | null> {
  const runner = runCommand ?? runCommandAsString;

  try {
    const { stdout } = await runner(getCommandLookupExecutable("win32"), [command], {
      windowsHide: true,
    });
    return (
      stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? null
    );
  } catch {
    return null;
  }
}

function resolveGitBashInstallPath(existsSync?: (file: string) => boolean): string | null {
  const fileExists = existsSync ?? fsExistsSync;
  const programFiles = firstNonEmpty(process.env.ProgramFiles);
  const programFilesX86 = firstNonEmpty(process.env["ProgramFiles(x86)"]);
  const localAppData = firstNonEmpty(process.env.LOCALAPPDATA);
  const candidates = [
    programFiles && path.win32.join(programFiles, "Git", "bin", "bash.exe"),
    programFiles && path.win32.join(programFiles, "Git", "usr", "bin", "bash.exe"),
    programFilesX86 && path.win32.join(programFilesX86, "Git", "bin", "bash.exe"),
    programFilesX86 && path.win32.join(programFilesX86, "Git", "usr", "bin", "bash.exe"),
    localAppData && path.win32.join(localAppData, "Programs", "Git", "bin", "bash.exe"),
    localAppData && path.win32.join(localAppData, "Programs", "Git", "usr", "bin", "bash.exe"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

function isGitForWindowsBashPath(filePath: string): boolean {
  const normalized = path.win32.normalize(filePath).replace(/\//g, "\\").toLowerCase();
  return (
    normalized.endsWith("\\git\\bin\\bash.exe") ||
    normalized.endsWith("\\git\\usr\\bin\\bash.exe") ||
    normalized.endsWith("\\portablegit\\bin\\bash.exe") ||
    normalized.endsWith("\\portablegit\\usr\\bin\\bash.exe")
  );
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  return values.find((value) => typeof value === "string" && value.length > 0) ?? null;
}
