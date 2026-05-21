import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface DocumentRecord {
  path: string;
  uri: string;
  languageId: string;
  text: string;
  version: number;
  open: boolean;
}

export class DocumentStore {
  private readonly docs = new Map<string, DocumentRecord>();

  constructor(private readonly workspacePath: string) {}

  open(input: { path: string; languageId: string; text: string }): DocumentRecord {
    const record: DocumentRecord = {
      path: input.path,
      uri: toFileUri(this.workspacePath, input.path),
      languageId: input.languageId,
      text: input.text,
      version: 1,
      open: true,
    };
    this.docs.set(input.path, record);
    return record;
  }

  change(filePath: string, text: string): DocumentRecord {
    const current = this.getOrThrow(filePath);
    const record: DocumentRecord = {
      ...current,
      text,
      version: current.version + 1,
      open: true,
    };
    this.docs.set(filePath, record);
    return record;
  }

  close(filePath: string): void {
    this.getOrThrow(filePath);
    this.docs.delete(filePath);
  }

  get(filePath: string): DocumentRecord | undefined {
    return this.docs.get(filePath);
  }

  listOpen(): DocumentRecord[] {
    return Array.from(this.docs.values()).filter((doc) => doc.open);
  }

  listReplayable(): DocumentRecord[] {
    return this.listOpen();
  }

  fromUri(uri: string): string | null {
    let absolutePath: string;

    try {
      const url = new URL(uri);
      if (url.protocol !== "file:") {
        return null;
      }
      absolutePath = fileURLToPath(url);
    } catch {
      return null;
    }

    const workspaceInfo = normalizeFileSystemPath(this.workspacePath);
    const absoluteInfo = normalizeFileSystemPath(absolutePath);
    if (workspaceInfo.kind !== absoluteInfo.kind) {
      return null;
    }

    const pathApi = workspaceInfo.kind === "win32" ? path.win32 : path.posix;
    const relativePath = pathApi.relative(workspaceInfo.value, absoluteInfo.value);

    if (relativePath.startsWith("..") || pathApi.isAbsolute(relativePath) || relativePath === "") {
      return null;
    }

    return relativePath.replace(/\\/g, "/");
  }

  private getOrThrow(filePath: string): DocumentRecord {
    const current = this.docs.get(filePath);
    if (!current) {
      throw new Error(`LSP document not open: ${filePath}`);
    }
    return current;
  }
}

function toFileUri(workspacePath: string, relativePath: string): string {
  return pathToFileURL(path.resolve(workspacePath, relativePath)).toString();
}

function normalizeFileSystemPath(input: string): { kind: "win32" | "posix"; value: string } {
  const normalized = input.replace(/\\/g, "/");
  const windowsMatch = normalized.match(/^\/?([A-Za-z]):\/?(.*)$/);
  if (windowsMatch) {
    const drive = windowsMatch[1]!.toLowerCase();
    const segments = windowsMatch[2] ? windowsMatch[2].split("/").filter(Boolean) : [];
    return {
      kind: "win32",
      value: path.win32.join(`${drive}:\\`, ...segments),
    };
  }

  return {
    kind: "posix",
    value: path.posix.normalize(normalized),
  };
}
