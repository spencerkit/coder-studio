import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  isWithinRange,
  parseOptionalTimestamp,
  resolveHomePath,
  safeJsonParse,
} from "./path-encoding.js";
import type {
  ProviderWorkLogDiscovery,
  ProviderWorkLogSource,
  WorkLogEvidenceExcerpt,
  WorkLogSession,
  WorkLogSourceRef,
} from "./types.js";

interface GeminiChat {
  kind?: string;
  sessionId?: string;
  startTime?: string | number;
  lastUpdated?: string | number;
  summary?: string;
  messages?: Array<{
    type?: string;
    timestamp?: string | number;
    content?: unknown;
  }>;
}

export function createGeminiWorkLogSource(options: { home?: string } = {}): ProviderWorkLogSource {
  return {
    providerId: "gemini",
    async discover(input) {
      const roots = ["~/.gemini/tmp", "~/.gemini/history"].map((path) =>
        resolveHomePath(path, options.home)
      );
      const sessions: WorkLogSession[] = [];
      const sourceRefs: WorkLogSourceRef[] = [];
      const warnings: ProviderWorkLogDiscovery["warnings"] = [];
      const seenSessions = new Set<string>();
      let parseErrorCount = 0;
      let sawRoot = false;

      for (const root of roots) {
        const rootStat = await stat(root).catch(() => undefined);
        if (!rootStat?.isDirectory()) {
          continue;
        }
        sawRoot = true;

        const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
        for (const project of projects) {
          if (!project.isDirectory()) {
            continue;
          }
          const projectDir = join(root, project.name);
          const projectRootPath = await readFile(join(projectDir, ".project_root"), "utf8").catch(
            () => ""
          );
          const workspacePath = projectRootPath.trim();
          if (workspacePath.length === 0) {
            continue;
          }

          const chatsDir = join(projectDir, "chats");
          const chatDirStat = await stat(chatsDir).catch(() => undefined);
          if (!chatDirStat?.isDirectory()) {
            continue;
          }

          const entries = await readdir(chatsDir, { withFileTypes: true }).catch(() => []);
          for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(".json")) {
              continue;
            }
            const filePath = join(chatsDir, entry.name);
            const fileStat = await stat(filePath).catch(() => undefined);
            if (!fileStat?.isFile()) {
              continue;
            }
            sourceRefs.push({
              providerId: "gemini",
              kind: "file",
              path: filePath,
              mtimeMs: fileStat.mtimeMs,
              sizeBytes: fileStat.size,
            });

            const chat = safeJsonParse<GeminiChat>(
              await readFile(filePath, "utf8").catch(() => "")
            );
            if (!chat) {
              parseErrorCount += 1;
              warnings.push({
                code: "parse_error",
                message: "Failed to parse Gemini chat JSON",
                sourceRef: filePath,
              });
              continue;
            }

            const startedAt = parseOptionalTimestamp(chat.startTime) ?? fileStat.mtimeMs;
            const lastActiveAt = parseOptionalTimestamp(chat.lastUpdated) ?? startedAt;
            if (!isWithinRange(startedAt, lastActiveAt, input.timeRange)) {
              continue;
            }

            const sessionId = chat.sessionId ?? basename(filePath, ".json");
            const dedupeKey = `${workspacePath}\u0000${sessionId}`;
            if (seenSessions.has(dedupeKey)) {
              continue;
            }

            let userTurnCount = 0;
            let assistantTurnCount = 0;
            const excerpts: WorkLogEvidenceExcerpt[] = [];
            for (const message of chat.messages ?? []) {
              const role = `${message.type ?? ""}`.toLowerCase();
              if (role.includes("user")) {
                userTurnCount += 1;
              } else if (role.includes("assistant") || role === "gemini") {
                assistantTurnCount += 1;
              }
              const text = takeGeminiMessageText(message.content);
              if (text && excerpts.length < 3) {
                excerpts.push({
                  role: role.includes("user")
                    ? "user"
                    : role.includes("assistant") || role === "gemini"
                      ? "assistant"
                      : "unknown",
                  at: parseOptionalTimestamp(message.timestamp),
                  text: text.slice(0, 240),
                });
              }
            }

            sessions.push({
              providerId: "gemini",
              sessionId,
              workspacePath,
              startedAt,
              lastActiveAt,
              sourceRef: filePath,
              title: chat.summary,
              userTurnCount,
              assistantTurnCount,
              toolUseCount: 0,
              parseErrorCount: 0,
              timestampQuality:
                parseOptionalTimestamp(chat.startTime) !== undefined ||
                parseOptionalTimestamp(chat.lastUpdated) !== undefined
                  ? "explicit"
                  : "file_mtime",
              evidence: [
                {
                  providerId: "gemini",
                  sessionId,
                  workspacePath,
                  title: chat.summary,
                  startedAt,
                  lastActiveAt,
                  excerpts,
                },
              ],
            });
            seenSessions.add(dedupeKey);
          }
        }
      }

      return {
        providerId: "gemini",
        status: !sawRoot
          ? "missing_root"
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

function takeGeminiMessageText(content: unknown): string | undefined {
  if (typeof content === "string") {
    const text = content.trim();
    return text.length > 0 ? text : undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      const text = Reflect.get(part, "text");
      return typeof text === "string" ? text.trim() : "";
    })
    .find((value): value is string => value.length > 0);
}
