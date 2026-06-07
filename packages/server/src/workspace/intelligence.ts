import type { Dirent } from "node:fs";
import { access, lstat, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { WorkspaceIntelligenceSummary } from "@coder-studio/core";
import { AGENT_INSTRUCTIONS_RELATIVE_PATH } from "./workspace-state.js";

type PackageManager = NonNullable<WorkspaceIntelligenceSummary["packageManager"]>;
type PackageScripts = WorkspaceIntelligenceSummary["scripts"];

interface PackageJsonManifest {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

interface WorkspaceIntelligenceInput {
  workspaceId: string;
  rootPath: string;
}

type PackageEntry = NonNullable<WorkspaceIntelligenceSummary["packages"]>[number];
type KeyDirectory = NonNullable<WorkspaceIntelligenceSummary["keyDirectories"]>[number];
type VerificationCommand = NonNullable<
  WorkspaceIntelligenceSummary["verificationCommands"]
>[number];
type DocumentationEntry = NonNullable<WorkspaceIntelligenceSummary["documentationEntries"]>[number];

const frameworkOrder = ["Next.js", "React", "Vite", "Node", "Monorepo"] as const;
const packageManagerCandidates: Array<{ file: string; manager: PackageManager }> = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lockb", manager: "bun" },
  { file: "package-lock.json", manager: "npm" },
];
const packageScriptKeys: Array<keyof PackageScripts> = ["dev", "test", "build", "lint"];
const noisyTopLevelDirectories = new Set([".git", "node_modules", "dist", "build", "coverage"]);
const preferredSupportDirectories = ["docs", "e2e", "scripts", "apps", "services"] as const;

export async function inspectWorkspaceIntelligence(
  input: WorkspaceIntelligenceInput
): Promise<WorkspaceIntelligenceSummary> {
  const [
    packageManager,
    manifest,
    git,
    docs,
    agentsExists,
    frameworks,
    topLevelDirectories,
    packageEntries,
    documentationEntries,
  ] = await Promise.all([
    detectPackageManager(input.rootPath),
    readPackageJson(input.rootPath),
    detectGitState(input.rootPath),
    detectDocs(input.rootPath),
    pathExists(join(input.rootPath, AGENT_INSTRUCTIONS_RELATIVE_PATH)),
    detectFrameworks(input.rootPath),
    detectTopLevelDirectories(input.rootPath),
    detectPackages(input.rootPath),
    detectDocumentationEntries(input.rootPath),
  ]);

  const scripts = extractScripts(manifest);
  const workspaceKind = inferWorkspaceKind({
    packageEntries,
    frameworks,
    topLevelDirectories,
  });
  const verificationCommands = buildVerificationCommands(packageManager, manifest?.scripts ?? {});
  const keyDirectories = selectKeyDirectories({
    packageEntries,
    topLevelDirectories,
    docs,
  });
  const fileConstraints = buildFileConstraints({
    workspaceKind,
    keyDirectories,
    verificationCommands,
  });

  return {
    workspaceId: input.workspaceId,
    rootPath: input.rootPath,
    git,
    packageManager,
    frameworks,
    scripts,
    recommendedCommands: buildRecommendedCommands(packageManager, scripts),
    docs,
    workspaceKind,
    topLevelDirectories,
    keyDirectories,
    packages: packageEntries,
    documentationEntries,
    verificationCommands,
    fileConstraints,
    agentInstructions: {
      exists: agentsExists,
      path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
    },
  };
}

async function detectPackageManager(rootPath: string): Promise<PackageManager | undefined> {
  if (await pathExists(join(rootPath, "pnpm-workspace.yaml"))) {
    return "pnpm";
  }

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

function buildPackageCommand(packageManager: PackageManager, scriptName: string): string {
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

async function detectTopLevelDirectories(rootPath: string): Promise<string[]> {
  try {
    const entries = await readdir(rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !noisyTopLevelDirectories.has(name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function detectPackages(rootPath: string): Promise<PackageEntry[]> {
  const packageRoots = ["packages", "apps"];
  const packages: PackageEntry[] = [];

  for (const packageRoot of packageRoots) {
    const packageRootPath = join(rootPath, packageRoot);
    let entries: Dirent[];
    try {
      entries = await readdir(packageRootPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const relativePath = `${packageRoot}/${entry.name}`;
      const manifest = await readPackageJson(join(rootPath, relativePath));
      if (!manifest) {
        continue;
      }

      packages.push({
        path: relativePath,
        name: typeof manifest.name === "string" ? manifest.name : undefined,
        role: inferPackageRole(
          relativePath,
          typeof manifest.name === "string" ? manifest.name : undefined
        ),
        scripts: Object.keys(manifest.scripts ?? {}).sort(),
      });
    }
  }

  return packages.sort((left, right) => comparePackageEntries(left, right));
}

async function detectDocumentationEntries(rootPath: string): Promise<DocumentationEntry[]> {
  const entries: DocumentationEntry[] = [];

  if (await pathExists(join(rootPath, "README.md"))) {
    entries.push({ path: "README.md", kind: "readme" });
  }

  for (const relativeRoot of ["docs/help", "docs/wiki"]) {
    const matches = await collectMarkdownEntries(rootPath, relativeRoot);
    entries.push(...matches);
  }

  return entries.slice(0, 6);
}

async function collectMarkdownEntries(
  rootPath: string,
  relativeRoot: string
): Promise<DocumentationEntry[]> {
  const absoluteRoot = join(rootPath, relativeRoot);
  let entries: Dirent[];
  try {
    entries = await readdir(absoluteRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => ({
      path: `${relativeRoot}/${entry.name}`,
      kind: relativeRoot.includes("/wiki") ? ("wiki" as const) : ("guide" as const),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function inferWorkspaceKind(input: {
  packageEntries: PackageEntry[];
  frameworks: string[];
  topLevelDirectories: string[];
}): NonNullable<WorkspaceIntelligenceSummary["workspaceKind"]> {
  if (
    input.frameworks.includes("Monorepo") ||
    input.packageEntries.length > 1 ||
    input.topLevelDirectories.includes("packages") ||
    input.topLevelDirectories.includes("apps")
  ) {
    return "monorepo";
  }

  if (input.frameworks.includes("Node")) {
    return "node_app";
  }

  return "unknown";
}

function inferPackageRole(packagePath: string, packageName?: string): PackageEntry["role"] {
  const target = `${packagePath} ${packageName ?? ""}`.toLowerCase();

  if (target.includes("web") || target.includes("frontend") || target.includes("ui")) {
    return "frontend_ui";
  }
  if (target.includes("server") || target.includes("backend") || target.includes("api")) {
    return "backend_runtime";
  }
  if (target.includes("provider")) {
    return "provider_integrations";
  }
  if (target.includes("core") || target.includes("contract") || target.includes("types")) {
    return "shared_contracts";
  }
  if (target.includes("cli")) {
    return "cli_entrypoint";
  }
  if (target.includes("util")) {
    return "shared_utilities";
  }

  return "shared_package";
}

function selectKeyDirectories(input: {
  packageEntries: PackageEntry[];
  topLevelDirectories: string[];
  docs: WorkspaceIntelligenceSummary["docs"];
}): KeyDirectory[] {
  const selected = new Map<string, KeyDirectory>();

  for (const entry of [...input.packageEntries].sort((left, right) =>
    comparePackageEntries(left, right)
  )) {
    const directory = buildKeyDirectoryFromPackage(entry);
    if (!selected.has(directory.path)) {
      selected.set(directory.path, directory);
    }
  }

  for (const supportDirectory of preferredSupportDirectories) {
    if (!input.topLevelDirectories.includes(supportDirectory)) {
      continue;
    }
    if (supportDirectory === "docs" && !input.docs.some((entry) => entry.path === "docs")) {
      continue;
    }
    const directory = buildSupportDirectorySummary(supportDirectory);
    if (!selected.has(directory.path)) {
      selected.set(directory.path, directory);
    }
  }

  return Array.from(selected.values()).slice(0, 6);
}

function buildKeyDirectoryFromPackage(entry: PackageEntry): KeyDirectory {
  switch (entry.role) {
    case "frontend_ui":
      return {
        path: entry.path,
        kind: "frontend",
        reason: "Primary frontend UI package for user-facing behavior.",
      };
    case "backend_runtime":
      return {
        path: entry.path,
        kind: "backend",
        reason: "Backend runtime package that owns server-side behavior.",
      };
    case "provider_integrations":
      return {
        path: entry.path,
        kind: "providers",
        reason: "Provider integration package for external model/runtime adapters.",
      };
    case "shared_contracts":
      return {
        path: entry.path,
        kind: "shared",
        reason: "Shared contracts and types used across packages.",
      };
    case "cli_entrypoint":
      return {
        path: entry.path,
        kind: "cli",
        reason: "Command-line entrypoint and launcher behavior.",
      };
    case "shared_utilities":
      return {
        path: entry.path,
        kind: "shared",
        reason: "Shared utility package reused by multiple packages.",
      };
    case "shared_package":
    default:
      return {
        path: entry.path,
        kind: "other",
        reason: "Supporting package that should follow existing local patterns.",
      };
  }
}

function buildSupportDirectorySummary(directory: string): KeyDirectory {
  switch (directory) {
    case "docs":
      return {
        path: "docs",
        kind: "docs",
        reason: "Project documentation and operational guidance for contributors.",
      };
    case "e2e":
      return {
        path: "e2e",
        kind: "tests",
        reason: "End-to-end test workflows and acceptance coverage.",
      };
    case "scripts":
      return {
        path: "scripts",
        kind: "scripts",
        reason: "Repository automation entrypoints used by development workflows.",
      };
    default:
      return {
        path: directory,
        kind: "other",
        reason: "Top-level workspace directory with project-specific support code.",
      };
  }
}

function comparePackageEntries(left: PackageEntry, right: PackageEntry): number {
  const delta = packageRoleWeight(left.role) - packageRoleWeight(right.role);
  return delta !== 0 ? delta : left.path.localeCompare(right.path);
}

function packageRoleWeight(role: PackageEntry["role"]): number {
  switch (role) {
    case "frontend_ui":
      return 0;
    case "backend_runtime":
      return 1;
    case "provider_integrations":
      return 2;
    case "shared_contracts":
      return 3;
    case "cli_entrypoint":
      return 4;
    case "shared_utilities":
      return 5;
    case "shared_package":
    default:
      return 6;
  }
}

function buildVerificationCommands(
  packageManager: PackageManager | undefined,
  scripts: Record<string, string>
): VerificationCommand[] {
  if (!packageManager) {
    return [];
  }

  const commands = Object.entries(scripts)
    .map(([scriptName, rawCommand]) => {
      const classification = classifyVerificationScript(scriptName, rawCommand);
      if (!classification) {
        return null;
      }

      return {
        command: buildPackageCommand(packageManager, scriptName),
        reason: classification.reason,
        priority: classification.priority,
      } satisfies VerificationCommand;
    })
    .filter((entry): entry is VerificationCommand => entry !== null);

  return commands
    .sort((left, right) => {
      const priorityDelta =
        verificationPriorityWeight(left.priority) - verificationPriorityWeight(right.priority);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const usefulnessDelta =
        verificationCommandWeight(left.command) - verificationCommandWeight(right.command);
      return usefulnessDelta !== 0 ? usefulnessDelta : left.command.localeCompare(right.command);
    })
    .slice(0, 6);
}

function classifyVerificationScript(
  scriptName: string,
  rawCommand: string
): Pick<VerificationCommand, "priority" | "reason"> | null {
  const name = scriptName.toLowerCase();
  const command = rawCommand.toLowerCase();

  if (name.includes("report") || name.includes("update-baseline")) {
    return null;
  }

  if (
    name.includes("verify") ||
    name.includes("acceptance") ||
    name.includes("e2e") ||
    name.includes("ci:test") ||
    name === "test"
  ) {
    return {
      priority: "verification",
      reason: "Repository-level validation workflow to run before handoff.",
    };
  }

  if (
    name.includes("typecheck") ||
    command.includes("tsc") ||
    name.includes("lint") ||
    name.includes("build")
  ) {
    return {
      priority: name.includes("build") ? "quality" : "quality",
      reason: name.includes("typecheck")
        ? "Static type validation for cross-package correctness."
        : name.includes("lint")
          ? "Code quality check aligned with repository lint rules."
          : "Build verification to confirm the current package graph still compiles.",
    };
  }

  if (name.includes("dev")) {
    return {
      priority: "dev",
      reason: "Primary local development entrypoint.",
    };
  }

  return null;
}

function verificationPriorityWeight(priority: VerificationCommand["priority"]): number {
  switch (priority) {
    case "verification":
      return 0;
    case "quality":
      return 1;
    case "dev":
    default:
      return 2;
  }
}

function verificationCommandWeight(command: string): number {
  if (command.includes("ci:verify")) {
    return 0;
  }
  if (command.includes("ci:test")) {
    return 1;
  }
  if (command.includes("ci:typecheck")) {
    return 2;
  }
  if (command.includes("ci:build")) {
    return 3;
  }
  if (command.includes("acceptance:phase1")) {
    return 4;
  }
  if (command.includes("lint")) {
    return 5;
  }
  if (command.endsWith(" test")) {
    return 6;
  }
  if (command.endsWith(" build")) {
    return 7;
  }
  if (command.endsWith(" dev")) {
    return 8;
  }

  return 9;
}

function buildFileConstraints(input: {
  workspaceKind: WorkspaceIntelligenceSummary["workspaceKind"];
  keyDirectories: KeyDirectory[];
  verificationCommands: VerificationCommand[];
}): string[] {
  const constraints: string[] = [];
  const keyDirectoryPaths = new Set(input.keyDirectories.map((entry) => entry.path));

  if (input.workspaceKind === "monorepo") {
    constraints.push(
      "Respect package boundaries and keep changes scoped to the package you are touching unless cross-package edits are required."
    );
    constraints.push("Avoid unrelated refactors across packages while solving a targeted task.");
  }

  if (keyDirectoryPaths.has("packages/web") && keyDirectoryPaths.has("packages/server")) {
    constraints.push(
      "Keep frontend changes in packages/web and backend runtime changes in packages/server unless the task explicitly crosses layers."
    );
  }

  if (input.verificationCommands.length > 0) {
    constraints.push("Use repository-level verification commands before claiming completion.");
  }

  return constraints;
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
