import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { error, ROOT_DIR, success } from "./shared/index.js";
import { isDirectExecution } from "./shared/process.js";

const ALLOWED_PACKAGE = "@spencer-kit/coder-studio";

export async function findChangesetMarkdownFiles(changesetDir: string): Promise<string[]> {
  const entries = await readdir(changesetDir, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => resolve(changesetDir, entry.name))
    .sort();
}

export async function assertAllowedChangesetPackages(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    const content = await readFile(filePath, "utf8");
    const packages = extractChangesetPackages(content);
    const disallowed = packages.filter((name) => name !== ALLOWED_PACKAGE);

    if (disallowed.length > 0) {
      throw new Error(
        `${filePath} includes unsupported release packages: ${disallowed.join(", ")}. ` +
          `Current release flow only allows ${ALLOWED_PACKAGE}.`
      );
    }
  }
}

export function extractChangesetPackages(content: string): string[] {
  const match = /^---\n([\s\S]*?)\n---/m.exec(content);
  if (!match) {
    return [];
  }

  const packages = new Set<string>();
  const packagePattern = /^"([^"]+)"\s*:\s*(major|minor|patch)\s*$/gm;

  for (const packageMatch of match[1].matchAll(packagePattern)) {
    packages.add(packageMatch[1]);
  }

  return Array.from(packages).sort();
}

async function main(): Promise<void> {
  const changesetDir = resolve(ROOT_DIR, ".changeset");
  const files = await findChangesetMarkdownFiles(changesetDir);
  await assertAllowedChangesetPackages(files);
  success(
    `Validated ${files.length} changeset file(s); release scope is limited to ${ALLOWED_PACKAGE}.`
  );
}

if (isDirectExecution(import.meta.url)) {
  main().catch((err) => {
    error(err.message);
    process.exit(1);
  });
}
