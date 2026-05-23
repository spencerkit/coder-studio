import type {
  SearchContentFileResult,
  SearchContentMatch,
  SearchContentResult,
} from "@coder-studio/core";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import { basename, join, relative } from "path";
import { createInterface } from "readline";
import { createGitignoreFilter } from "./gitignore.js";

const FALLBACK_MAX_FILE_BYTES = 1_000_000;

export interface SearchFileContentsOptions {
  query: string;
  maxFiles: number;
  maxMatchesPerFile: number;
}

interface FileAccumulator {
  path: string;
  name: string;
  matches: SearchContentMatch[];
  matchCount: number;
}

interface SearchAccumulatorResult {
  files: FileAccumulator[];
  totalMatchCount: number;
  hasMoreFiles: boolean;
}

export async function searchFileContents(
  rootPath: string,
  options: SearchFileContentsOptions
): Promise<SearchContentResult> {
  const query = options.query.trim();
  if (!query) {
    return {
      files: [],
      totalMatchCount: 0,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    };
  }

  const result = await searchWithRipgrep(rootPath, query, options.maxFiles).catch(
    async (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return searchWithNode(rootPath, query, options.maxFiles);
      }

      throw error;
    }
  );

  return finalizeResults(result, options.maxFiles, options.maxMatchesPerFile);
}

async function searchWithRipgrep(
  rootPath: string,
  query: string,
  maxFiles: number
): Promise<SearchAccumulatorResult> {
  const hasGitignore = existsSync(join(rootPath, ".gitignore"));
  const args = [
    "--json",
    "--line-number",
    "--column",
    "--fixed-strings",
    "--sort",
    "path",
    "--with-filename",
    "--glob",
    "!**/.git/**",
    "--glob",
    "!**/node_modules/**",
  ];

  if (hasGitignore) {
    args.push("--hidden");
    args.push("--no-require-git");
  }

  args.push(query, ".");

  return new Promise((resolve, reject) => {
    const child = spawn("rg", args, { cwd: rootPath, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = createInterface({ input: child.stdout });
    const files = new Map<string, FileAccumulator>();
    let totalMatchCount = 0;
    let hasMoreFiles = false;
    let stderr = "";

    stdout.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      const event = JSON.parse(line) as {
        type?: string;
        data?: {
          path?: { text?: string };
          line_number?: number;
          lines?: { text?: string };
          submatches?: Array<{ start: number; end: number }>;
        };
      };

      if (event.type !== "match") {
        return;
      }

      const rawPath = event.data?.path?.text;
      if (!rawPath) {
        return;
      }

      const relativePath = normalizeRelativePath(relative(rootPath, join(rootPath, rawPath)));
      const preview = (event.data?.lines?.text ?? "").replace(/\r?\n$/, "");
      const lineNumber = event.data?.line_number ?? 1;
      const submatches = event.data?.submatches ?? [];

      totalMatchCount += submatches.length;

      if (!files.has(relativePath) && files.size >= maxFiles) {
        hasMoreFiles = true;
        return;
      }

      for (const submatch of submatches) {
        pushMatch(files, relativePath, {
          line: lineNumber,
          column: byteOffsetToColumn(preview, submatch.start),
          endColumn: byteOffsetToColumn(preview, submatch.end),
          preview,
          previewColumnStart: byteOffsetToColumn(preview, submatch.start),
          previewColumnEnd: byteOffsetToColumn(preview, submatch.end),
        });
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      void stdout.close();
      reject(error);
    });

    child.on("close", (code) => {
      void stdout.close();

      if (code === 0 || code === 1) {
        resolve({
          files: sortAccumulators(files),
          totalMatchCount,
          hasMoreFiles,
        });
        return;
      }

      reject(
        Object.assign(new Error(stderr || `rg exited with code ${code ?? "unknown"}`), { code })
      );
    });
  });
}

async function searchWithNode(
  rootPath: string,
  query: string,
  maxFiles: number
): Promise<SearchAccumulatorResult> {
  const files = new Map<string, FileAccumulator>();
  let totalMatchCount = 0;
  let hasMoreFiles = false;

  async function walk(dirPath: string): Promise<void> {
    const filter = createGitignoreFilter(rootPath, dirPath);
    const entries = await readdir(dirPath, { withFileTypes: true });
    const filteredEntries = entries.filter((entry) => filter(entry.name));
    filteredEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of filteredEntries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStat = await stat(fullPath);
      if (fileStat.size > FALLBACK_MAX_FILE_BYTES) {
        continue;
      }

      const buffer = await readFile(fullPath);
      if (isBinaryFile(buffer)) {
        continue;
      }

      const relativePath = normalizeRelativePath(relative(rootPath, fullPath));
      const file = collectMatchesFromText(relativePath, buffer.toString("utf-8"), query);
      if (!file) {
        continue;
      }

      totalMatchCount += file.matchCount;

      if (files.size >= maxFiles) {
        hasMoreFiles = true;
        continue;
      }

      files.set(relativePath, file);
    }
  }

  await walk(rootPath);
  return {
    files: sortAccumulators(files),
    totalMatchCount,
    hasMoreFiles,
  };
}

function collectMatchesFromText(
  relativePath: string,
  content: string,
  query: string
): FileAccumulator | null {
  const file: FileAccumulator = {
    path: relativePath,
    name: basename(relativePath),
    matches: [],
    matchCount: 0,
  };
  const lines = content.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const preview = lines[lineIndex] ?? "";
    if (!preview) {
      continue;
    }

    let fromIndex = 0;
    while (fromIndex <= preview.length) {
      const matchIndex = preview.indexOf(query, fromIndex);
      if (matchIndex === -1) {
        break;
      }

      const startColumn = matchIndex + 1;
      const endColumn = startColumn + query.length;
      file.matches.push({
        line: lineIndex + 1,
        column: startColumn,
        endColumn,
        preview,
        previewColumnStart: startColumn,
        previewColumnEnd: endColumn,
      });
      file.matchCount += 1;
      fromIndex = matchIndex + Math.max(query.length, 1);
    }
  }

  return file.matchCount > 0 ? file : null;
}

function pushMatch(
  files: Map<string, FileAccumulator>,
  relativePath: string,
  match: SearchContentMatch
): void {
  let file = files.get(relativePath);
  if (!file) {
    file = {
      path: relativePath,
      name: basename(relativePath),
      matches: [],
      matchCount: 0,
    };
    files.set(relativePath, file);
  }

  file.matches.push(match);
  file.matchCount += 1;
}

function sortAccumulators(files: Map<string, FileAccumulator>): FileAccumulator[] {
  return Array.from(files.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function finalizeResults(
  result: SearchAccumulatorResult,
  maxFiles: number,
  maxMatchesPerFile: number
): SearchContentResult {
  const visibleFiles = result.files.slice(0, maxFiles).map<SearchContentFileResult>((file) => ({
    path: file.path,
    name: file.name,
    matchCount: file.matchCount,
    hasMoreMatches: file.matchCount > maxMatchesPerFile,
    matches: file.matches.slice(0, maxMatchesPerFile),
  }));

  return {
    files: visibleFiles,
    totalMatchCount: result.totalMatchCount,
    hasMoreFiles: result.hasMoreFiles || result.files.length > maxFiles,
    truncatedMatchFileCount: visibleFiles.filter((file) => file.hasMoreMatches).length,
  };
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function byteOffsetToColumn(preview: string, byteOffset: number): number {
  return Buffer.from(preview, "utf8").subarray(0, byteOffset).toString("utf8").length + 1;
}

function isBinaryFile(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}
