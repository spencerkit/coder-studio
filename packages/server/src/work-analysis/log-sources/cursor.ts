import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { isWithinRange, resolveHomePath, safeJsonParse } from "./path-encoding.js";
import type {
  ProviderWorkLogDiscovery,
  ProviderWorkLogSource,
  WorkLogSession,
  WorkLogSourceRef,
} from "./types.js";

interface CursorRecord {
  role?: string;
  cwd?: string;
  message?: {
    content?: Array<{
      type?: string;
      name?: string;
      text?: string;
    }>;
  };
}

export function createCursorWorkLogSource(options: { home?: string } = {}): ProviderWorkLogSource {
  return {
    providerId: "cursor",
    async discover(input) {
      const root = resolveHomePath("~/.cursor/projects", options.home);
      const sessions: WorkLogSession[] = [];
      const sourceRefs: WorkLogSourceRef[] = [];
      const warnings: ProviderWorkLogDiscovery["warnings"] = [];
      let parseErrorCount = 0;
      const rootStat = await stat(root).catch(() => undefined);
      if (!rootStat?.isDirectory()) {
        return {
          providerId: "cursor",
          status: "missing_root",
          sessions: [],
          sourceRefs: [],
          parseErrorCount: 0,
          warnings: [],
        };
      }

      const projectDirs = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const projectDir of projectDirs) {
        if (!projectDir.isDirectory()) {
          continue;
        }
        const dir = join(root, projectDir.name, "agent-transcripts");
        const dirStat = await stat(dir).catch(() => undefined);
        if (!dirStat?.isDirectory()) {
          continue;
        }

        const transcriptDirs = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const transcriptDir of transcriptDirs) {
          if (!transcriptDir.isDirectory()) {
            continue;
          }
          const transcriptRoot = join(dir, transcriptDir.name);
          const transcriptFiles = await readdir(transcriptRoot, { withFileTypes: true }).catch(
            () => []
          );
          for (const transcriptFile of transcriptFiles) {
            if (!transcriptFile.isFile() || !transcriptFile.name.endsWith(".jsonl")) {
              continue;
            }
            const transcriptPath = join(transcriptRoot, transcriptFile.name);
            const fileStat = await stat(transcriptPath).catch(() => undefined);
            if (!fileStat?.isFile()) {
              continue;
            }
            sourceRefs.push({
              providerId: "cursor",
              kind: "file",
              path: transcriptPath,
              mtimeMs: fileStat.mtimeMs,
              sizeBytes: fileStat.size,
            });

            const content = await readFile(transcriptPath, "utf8").catch(() => "");
            const lines = content.split("\n").filter((line) => line.trim().length > 0);
            let userTurnCount = 0;
            let assistantTurnCount = 0;
            let toolUseCount = 0;
            let fileParseErrors = 0;
            let workspacePath: string | undefined;

            for (const line of lines) {
              const record = safeJsonParse<CursorRecord>(line);
              if (!record) {
                fileParseErrors += 1;
                continue;
              }
              workspacePath ??=
                typeof record.cwd === "string" && record.cwd.length > 0 ? record.cwd : undefined;
              if (record.role === "user") {
                userTurnCount += 1;
              } else if (record.role === "assistant") {
                assistantTurnCount += 1;
              }
              for (const part of record.message?.content ?? []) {
                const marker = `${part.type ?? ""} ${part.name ?? ""}`.toLowerCase();
                if (
                  marker.includes("tool") ||
                  marker.includes("command") ||
                  marker.includes("function")
                ) {
                  toolUseCount += 1;
                }
              }
            }

            parseErrorCount += fileParseErrors;
            if (
              !workspacePath ||
              !isWithinRange(fileStat.mtimeMs, fileStat.mtimeMs, input.timeRange)
            ) {
              continue;
            }

            sessions.push({
              providerId: "cursor",
              sessionId: basename(transcriptPath, ".jsonl"),
              workspacePath,
              startedAt: fileStat.mtimeMs,
              lastActiveAt: fileStat.mtimeMs,
              sourceRef: transcriptPath,
              userTurnCount,
              assistantTurnCount,
              toolUseCount,
              parseErrorCount: fileParseErrors,
              timestampQuality: "file_mtime",
            });

            if (fileParseErrors > 0) {
              warnings.push({
                code: "parse_error",
                message: `Failed to parse ${fileParseErrors} line(s) from Cursor transcript`,
                sourceRef: transcriptPath,
              });
            }
          }
        }
      }

      return {
        providerId: "cursor",
        status:
          warnings.length > 0
            ? "partial"
            : sessions.length === 0
              ? "no_logs"
              : parseErrorCount > 0
                ? "partial"
                : "supported",
        sessions,
        sourceRefs,
        parseErrorCount,
        warnings,
      };
    },
  };
}
