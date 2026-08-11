import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { error, ROOT_DIR, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

export interface TypeDiagnosticEntry {
  file: string;
  code: number;
  message: string;
  count: number;
}

export interface TypeDiagnosticBaseline {
  schemaVersion: 1;
  project: string;
  diagnostics: TypeDiagnosticEntry[];
}

export interface TypeDiagnosticComparison {
  baselineCount: number;
  currentCount: number;
  resolvedCount: number;
  newDiagnostics: TypeDiagnosticEntry[];
}

const DEFAULT_PROJECT = "packages/web/tsconfig.json";
const DEFAULT_BASELINE = "scripts/typecheck-baselines/web.json";

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function normalizeMessage(message: string, projectRoot: string): string {
  const normalizedRoot = normalizePath(resolve(projectRoot));
  return normalizePath(message).replaceAll(normalizedRoot, "<project>").replaceAll("\r\n", "\n");
}

function diagnosticIdentity(entry: Omit<TypeDiagnosticEntry, "count">): string {
  return JSON.stringify([entry.file, entry.code, entry.message]);
}

export function aggregateTypeDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
  projectRoot: string
): TypeDiagnosticEntry[] {
  const entries = new Map<string, TypeDiagnosticEntry>();

  for (const diagnostic of diagnostics) {
    const entry = {
      file: diagnostic.file
        ? normalizePath(relative(projectRoot, diagnostic.file.fileName))
        : "<global>",
      code: diagnostic.code,
      message: normalizeMessage(
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        projectRoot
      ),
    };
    const identity = diagnosticIdentity(entry);
    const existing = entries.get(identity);
    if (existing) {
      existing.count += 1;
    } else {
      entries.set(identity, { ...entry, count: 1 });
    }
  }

  return [...entries.values()].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.code - right.code ||
      left.message.localeCompare(right.message)
  );
}

export function compareTypeDiagnostics(
  baseline: readonly TypeDiagnosticEntry[],
  current: readonly TypeDiagnosticEntry[]
): TypeDiagnosticComparison {
  const allowed = new Map(
    baseline.map((entry) => [diagnosticIdentity(entry), entry.count] as const)
  );
  const newDiagnostics: TypeDiagnosticEntry[] = [];

  for (const entry of current) {
    const extraCount = entry.count - (allowed.get(diagnosticIdentity(entry)) ?? 0);
    if (extraCount > 0) newDiagnostics.push({ ...entry, count: extraCount });
  }

  const baselineCount = baseline.reduce((total, entry) => total + entry.count, 0);
  const currentCount = current.reduce((total, entry) => total + entry.count, 0);
  const newCount = newDiagnostics.reduce((total, entry) => total + entry.count, 0);

  return {
    baselineCount,
    currentCount,
    resolvedCount: Math.max(0, baselineCount - currentCount + newCount),
    newDiagnostics,
  };
}

export function collectTypeDiagnostics(configPath: string): TypeDiagnosticEntry[] {
  const absoluteConfigPath = resolve(configPath);
  const projectRoot = dirname(absoluteConfigPath);
  const config = ts.readConfigFile(absoluteConfigPath, ts.sys.readFile);
  if (config.error) return aggregateTypeDiagnostics([config.error], projectRoot);

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    projectRoot,
    { noEmit: true },
    absoluteConfigPath
  );
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
  });
  return aggregateTypeDiagnostics(
    [...parsed.errors, ...ts.getPreEmitDiagnostics(program)],
    projectRoot
  );
}

export async function checkTypeDiagnosticBaseline(options: {
  projectPath: string;
  baselinePath: string;
  update: boolean;
}): Promise<TypeDiagnosticComparison> {
  const projectPath = resolve(options.projectPath);
  const baselinePath = resolve(options.baselinePath);
  const diagnostics = collectTypeDiagnostics(projectPath);
  const project = normalizePath(relative(ROOT_DIR, projectPath));

  if (options.update) {
    const baseline: TypeDiagnosticBaseline = {
      schemaVersion: 1,
      project,
      diagnostics,
    };
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    return compareTypeDiagnostics(diagnostics, diagnostics);
  }

  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as TypeDiagnosticBaseline;
  if (baseline.schemaVersion !== 1 || baseline.project !== project) {
    throw new Error(`Type diagnostic baseline does not match ${project}`);
  }
  return compareTypeDiagnostics(baseline.diagnostics, diagnostics);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const update = args.delete("--update");
  if (args.size > 0)
    throw new Error(`Unknown typecheck baseline arguments: ${[...args].join(" ")}`);

  const result = await checkTypeDiagnosticBaseline({
    projectPath: resolve(ROOT_DIR, DEFAULT_PROJECT),
    baselinePath: resolve(ROOT_DIR, DEFAULT_BASELINE),
    update,
  });

  if (update) {
    success(`Updated Web typecheck baseline with ${result.currentCount} known diagnostics.`);
    return;
  }
  if (result.newDiagnostics.length > 0) {
    const details = result.newDiagnostics
      .slice(0, 20)
      .map(
        (entry) =>
          `${entry.file} TS${entry.code} x${entry.count}: ${entry.message.replaceAll("\n", " ")}`
      )
      .join("\n");
    throw new Error(
      `Web typecheck introduced ${result.newDiagnostics.reduce((sum, entry) => sum + entry.count, 0)} new diagnostic(s):\n${details}`
    );
  }

  success(
    `Web typecheck introduced no new diagnostics (${result.currentCount} current, ${result.resolvedCount} resolved from baseline).`
  );
}

if (isDirectExecution(import.meta.url)) {
  main().catch((err: unknown) => {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
