import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LspServerKind, LspToolSource } from "@coder-studio/core";

export interface ManagedLspToolManifest {
  serverKind: LspServerKind;
  version: string;
  executablePath: string;
  installedAt: number;
  source: Extract<LspToolSource, "managed">;
  platform: NodeJS.Platform;
}

export class FileManifestStore {
  constructor(private readonly root: string) {}

  getRoot(): string {
    return this.root;
  }

  read(serverKind: LspServerKind): ManagedLspToolManifest | null {
    const path = this.pathFor(serverKind);
    if (!existsSync(path)) {
      return null;
    }

    return JSON.parse(readFileSync(path, "utf8")) as ManagedLspToolManifest;
  }

  write(serverKind: LspServerKind, manifest: ManagedLspToolManifest): void {
    const path = this.pathFor(serverKind);
    mkdirSync(join(this.root, serverKind), { recursive: true });
    writeFileSync(path, JSON.stringify(manifest, null, 2));
  }

  private pathFor(serverKind: LspServerKind): string {
    return join(this.root, serverKind, "manifest.json");
  }
}
