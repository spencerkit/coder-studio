import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TaskDefinition, TaskKind, TaskSource } from "@coder-studio/core";
import { z } from "zod";

export interface TaskDiscoveryInput {
  workspaceId: string;
  rootPath: string;
}

export interface TaskDiscoveryWarning {
  source: TaskSource;
  message: string;
}

export interface TaskDiscoveryResult {
  tasks: TaskDefinition[];
  warnings: TaskDiscoveryWarning[];
}

const coderStudioTaskSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["verify", "test", "lint", "build", "dev", "custom"]),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwdPath: z.string().optional(),
});

const coderStudioTasksFileSchema = z.object({
  version: z.literal(1),
  tasks: z.array(coderStudioTaskSchema),
});

const packageJsonSchema = z.object({
  scripts: z.record(z.string(), z.string()).optional(),
});

type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

const ROOT_FILE_CANDIDATES = [
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
] as const;

const PACKAGE_SCRIPT_PRIORITIES: Array<[scriptName: string, kind: TaskKind, priority: number]> = [
  ["verify", "verify", 800],
  ["test", "test", 700],
  ["lint", "lint", 600],
  ["build", "build", 500],
  ["dev", "dev", 100],
];

const MAKEFILE_TARGETS: Array<[target: string, kind: TaskKind, priority: number]> = [
  ["verify", "verify", 400],
  ["test", "test", 390],
  ["lint", "lint", 380],
  ["build", "build", 370],
];

function uniqueTasks(tasks: TaskDefinition[]): TaskDefinition[] {
  const seen = new Set<string>();
  const result: TaskDefinition[] = [];
  for (const task of [...tasks].sort((left, right) => right.priority - left.priority)) {
    if (seen.has(task.id)) {
      continue;
    }
    seen.add(task.id);
    result.push(task);
  }
  return result;
}

function packageManagerFor(rootFiles: Set<string>): PackageManager {
  if (rootFiles.has("pnpm-lock.yaml") || rootFiles.has("pnpm-workspace.yaml")) return "pnpm";
  if (rootFiles.has("yarn.lock")) return "yarn";
  if (rootFiles.has("bun.lockb") || rootFiles.has("bun.lock")) return "bun";
  return "npm";
}

function packageScriptArgs(packageManager: PackageManager, scriptName: string): string[] {
  if (packageManager === "pnpm") {
    return [scriptName];
  }
  return ["run", scriptName];
}

function scriptTask(
  workspaceId: string,
  scriptName: string,
  kind: TaskKind,
  packageManager: PackageManager,
  priority: number
): TaskDefinition {
  return {
    id: kind === "verify" ? "verify" : kind,
    workspaceId,
    kind,
    label: kind[0]!.toUpperCase() + kind.slice(1),
    command: packageManager,
    args: packageScriptArgs(packageManager, scriptName),
    cwdPath: ".",
    source: "package-json",
    priority,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectRootFiles(rootPath: string): Promise<Set<string>> {
  const rootFiles = new Set<string>();
  await Promise.all(
    ROOT_FILE_CANDIDATES.map(async (fileName) => {
      if (await fileExists(join(rootPath, fileName))) {
        rootFiles.add(fileName);
      }
    })
  );
  return rootFiles;
}

function warningFor(source: TaskSource, path: string, error: unknown): TaskDiscoveryWarning {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    source,
    message: `Failed to discover tasks from ${path}: ${detail}`,
  };
}

async function discoverCoderStudioTasks(
  input: TaskDiscoveryInput,
  warnings: TaskDiscoveryWarning[]
): Promise<TaskDefinition[]> {
  const path = join(input.rootPath, ".coder-studio", "tasks.json");
  if (!(await fileExists(path))) {
    return [];
  }

  try {
    const parsed = coderStudioTasksFileSchema.parse(JSON.parse(await readFile(path, "utf8")));
    return parsed.tasks.map((task, index) => ({
      ...task,
      workspaceId: input.workspaceId,
      source: "coder-studio",
      priority: 1000 - index,
    }));
  } catch (error) {
    warnings.push(warningFor("coder-studio", path, error));
    return [];
  }
}

async function discoverPackageJsonTasks(
  input: TaskDiscoveryInput,
  rootFiles: Set<string>,
  warnings: TaskDiscoveryWarning[]
): Promise<TaskDefinition[]> {
  const path = join(input.rootPath, "package.json");
  if (!(await fileExists(path))) {
    return [];
  }

  try {
    const packageJson = packageJsonSchema.parse(JSON.parse(await readFile(path, "utf8")));
    const scripts = packageJson.scripts ?? {};
    const packageManager = packageManagerFor(rootFiles);
    const tasks: TaskDefinition[] = [];

    if (scripts["ci:verify"]) {
      tasks.push(scriptTask(input.workspaceId, "ci:verify", "verify", packageManager, 900));
    }

    for (const [scriptName, kind, priority] of PACKAGE_SCRIPT_PRIORITIES) {
      if (scripts[scriptName]) {
        tasks.push(scriptTask(input.workspaceId, scriptName, kind, packageManager, priority));
      }
    }

    return tasks;
  } catch (error) {
    warnings.push(warningFor("package-json", path, error));
    return [];
  }
}

async function discoverConventionTask(
  input: TaskDiscoveryInput,
  fileName: string,
  task: Omit<TaskDefinition, "workspaceId" | "priority">,
  priority: number
): Promise<TaskDefinition[]> {
  if (!(await fileExists(join(input.rootPath, fileName)))) {
    return [];
  }
  return [{ ...task, workspaceId: input.workspaceId, priority }];
}

async function discoverMakefileTasks(
  input: TaskDiscoveryInput,
  warnings: TaskDiscoveryWarning[]
): Promise<TaskDefinition[]> {
  const path = join(input.rootPath, "Makefile");
  if (!(await fileExists(path))) {
    return [];
  }

  try {
    const content = await readFile(path, "utf8");
    const targets = new Set<string>();
    for (const line of content.split(/\r?\n/)) {
      const match = /^([A-Za-z0-9_.-]+)\s*:(?!\s*[=:+?])/.exec(line);
      if (match?.[1]) {
        targets.add(match[1]);
      }
    }

    return MAKEFILE_TARGETS.filter(([target]) => targets.has(target)).map(
      ([target, kind, priority]) => ({
        id: `make-${target}`,
        workspaceId: input.workspaceId,
        kind,
        label: `Make ${target[0]!.toUpperCase()}${target.slice(1)}`,
        command: "make",
        args: [target],
        cwdPath: ".",
        source: "makefile",
        priority,
      })
    );
  } catch (error) {
    warnings.push(warningFor("makefile", path, error));
    return [];
  }
}

export async function discoverTasks(input: TaskDiscoveryInput): Promise<TaskDiscoveryResult> {
  const warnings: TaskDiscoveryWarning[] = [];
  const rootFiles = await detectRootFiles(input.rootPath);
  const tasks: TaskDefinition[] = [];

  tasks.push(...(await discoverCoderStudioTasks(input, warnings)));
  tasks.push(...(await discoverPackageJsonTasks(input, rootFiles, warnings)));
  tasks.push(
    ...(await discoverConventionTask(
      input,
      "Cargo.toml",
      {
        id: "cargo-test",
        kind: "test",
        label: "Cargo Test",
        command: "cargo",
        args: ["test"],
        cwdPath: ".",
        source: "cargo",
      },
      300
    ))
  );
  tasks.push(
    ...(await discoverConventionTask(
      input,
      "go.mod",
      {
        id: "go-test",
        kind: "test",
        label: "Go Test",
        command: "go",
        args: ["test", "./..."],
        cwdPath: ".",
        source: "go",
      },
      290
    ))
  );
  tasks.push(
    ...(await discoverConventionTask(
      input,
      "pyproject.toml",
      {
        id: "python-test",
        kind: "test",
        label: "Python Test",
        command: "python",
        args: ["-m", "pytest"],
        cwdPath: ".",
        source: "python",
      },
      280
    ))
  );
  tasks.push(...(await discoverMakefileTasks(input, warnings)));

  return {
    tasks: uniqueTasks(tasks),
    warnings,
  };
}
