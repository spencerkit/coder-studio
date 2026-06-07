import { access, lstat, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { WorkspaceIntelligenceSummary } from "@coder-studio/core";
import { AGENT_INSTRUCTIONS_RELATIVE_PATH } from "./workspace-state.js";

type PackageManager = NonNullable<WorkspaceIntelligenceSummary["packageManager"]>;
type PackageScripts = WorkspaceIntelligenceSummary["scripts"];

interface PackageJsonManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface WorkspaceIntelligenceInput {
  workspaceId: string;
  rootPath: string;
}

const frameworkOrder = ["Next.js", "React", "Vite", "Node", "Monorepo"] as const;
const packageManagerCandidates: Array<{ file: string; manager: PackageManager }> = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lockb", manager: "bun" },
  { file: "package-lock.json", manager: "npm" },
];
const packageScriptKeys: Array<keyof PackageScripts> = ["dev", "test", "build", "lint"];

export async function inspectWorkspaceIntelligence(
  input: WorkspaceIntelligenceInput
): Promise<WorkspaceIntelligenceSummary> {
  const [packageManager, manifest, git, docsExistence, agentsExists, frameworks] =
    await Promise.all([
      detectPackageManager(input.rootPath),
      readPackageJson(input.rootPath),
      detectGitState(input.rootPath),
      detectDocs(input.rootPath),
      pathExists(join(input.rootPath, AGENT_INSTRUCTIONS_RELATIVE_PATH)),
      detectFrameworks(input.rootPath),
    ]);

  const scripts = extractScripts(manifest);

  return {
    workspaceId: input.workspaceId,
    rootPath: input.rootPath,
    git,
    packageManager,
    frameworks,
    scripts,
    recommendedCommands: buildRecommendedCommands(packageManager, scripts),
    docs: docsExistence,
    agentInstructions: {
      exists: agentsExists,
      path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
    },
  };
}

async function detectPackageManager(rootPath: string): Promise<PackageManager | undefined> {
  for (const candidate of packageManagerCandidates) {
    if (await pathExists(join(rootPath, candidate.file))) {
      return candidate.manager;
    }
  }

  if (await pathExists(join(rootPath, "package.json"))) {
    return "npm";
  }

  return undefined;
}

async function readPackageJson(rootPath: string): Promise<PackageJsonManifest | null> {
  const packageJsonPath = join(rootPath, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return null;
  }

  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as PackageJsonManifest;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractScripts(manifest: PackageJsonManifest | null): PackageScripts {
  const scripts = manifest?.scripts ?? {};

  return {
    dev: normalizeScript(scripts.dev),
    test: normalizeScript(scripts.test),
    build: normalizeScript(scripts.build),
    lint: normalizeScript(scripts.lint),
  };
}

function normalizeScript(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function buildRecommendedCommands(
  packageManager: PackageManager | undefined,
  scripts: PackageScripts
): WorkspaceIntelligenceSummary["recommendedCommands"] {
  if (!packageManager) {
    return [];
  }

  return packageScriptKeys.flatMap((key) => {
    if (!scripts[key]) {
      return [];
    }

    return [
      {
        key,
        command: buildPackageCommand(packageManager, key),
        source: "package_json" as const,
      },
    ];
  });
}

function buildPackageCommand(
  packageManager: PackageManager,
  scriptName: keyof PackageScripts
): string {
  switch (packageManager) {
    case "pnpm":
      return `pnpm ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "bun":
      return `bun run ${scriptName}`;
    case "npm":
    default:
      return `npm run ${scriptName}`;
  }
}

async function detectFrameworks(rootPath: string): Promise<string[]> {
  const manifest = await readPackageJson(rootPath);
  const deps = {
    ...(manifest?.dependencies ?? {}),
    ...(manifest?.devDependencies ?? {}),
  };
  const frameworks = new Set<string>();

  if ("next" in deps) {
    frameworks.add("Next.js");
  }
  if ("react" in deps) {
    frameworks.add("React");
  }
  if ("vite" in deps || (await hasAnyPath(rootPath, viteConfigFiles))) {
    frameworks.add("Vite");
  }
  if (manifest) {
    frameworks.add("Node");
  }
  if (await hasAnyPath(rootPath, ["pnpm-workspace.yaml", "turbo.json", "nx.json"])) {
    frameworks.add("Monorepo");
  }

  return frameworkOrder.filter((framework) => frameworks.has(framework));
}

const viteConfigFiles = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
] as const;

async function detectGitState(rootPath: string): Promise<WorkspaceIntelligenceSummary["git"]> {
  const gitPath = join(rootPath, ".git");
  let stats;
  try {
    stats = await lstat(gitPath);
  } catch {
    return { isRepo: false };
  }

  const gitDir = stats.isDirectory()
    ? gitPath
    : stats.isFile()
      ? await resolveGitDirFromFile(rootPath, gitPath)
      : null;

  if (!gitDir) {
    return { isRepo: false };
  }

  const branch = await readGitBranch(gitDir);
  return branch ? { isRepo: true, branch } : { isRepo: true };
}

async function resolveGitDirFromFile(
  rootPath: string,
  gitFilePath: string
): Promise<string | null> {
  try {
    const raw = await readFile(gitFilePath, "utf8");
    const match = raw.match(/^gitdir:\s*(.+)\s*$/m);
    if (!match) {
      return null;
    }

    const gitDirPath = match[1];
    if (!gitDirPath) {
      return null;
    }
    return resolve(rootPath, gitDirPath);
  } catch {
    return null;
  }
}

async function readGitBranch(gitDir: string): Promise<string | undefined> {
  try {
    const head = await readFile(join(gitDir, "HEAD"), "utf8");
    const refMatch = head.match(/^ref:\s*refs\/heads\/(.+)\s*$/);
    return refMatch?.[1];
  } catch {
    return undefined;
  }
}

async function detectDocs(rootPath: string): Promise<WorkspaceIntelligenceSummary["docs"]> {
  const docs: WorkspaceIntelligenceSummary["docs"] = [];

  if (await pathExists(join(rootPath, "README.md"))) {
    docs.push({ path: "README.md", kind: "readme" });
  }

  if (await pathExists(join(rootPath, "docs"))) {
    try {
      const docsStats = await stat(join(rootPath, "docs"));
      if (docsStats.isDirectory()) {
        docs.push({ path: "docs", kind: "docs" });
      }
    } catch {
      // Ignore a disappearing docs entry and keep the rest of the summary.
    }
  }

  return docs;
}

async function hasAnyPath(rootPath: string, relativePaths: readonly string[]): Promise<boolean> {
  for (const relativePath of relativePaths) {
    if (await pathExists(join(rootPath, relativePath))) {
      return true;
    }
  }

  return false;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
