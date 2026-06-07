import { createHash } from "node:crypto";
import type { ProviderDefinition } from "@coder-studio/core";
import { mergeProviderLaunchConfig } from "../provider-config.js";
import { type CommandRunner, runCommandAsString } from "../provider-runtime/command-runner.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { buildSessionAnalysisPrompt } from "./prompt.js";
import { sessionAnalysisResultSchema } from "./schema.js";
import type { SessionAnalysisContext, SessionAnalysisResult } from "./types.js";

export interface SessionAnalysisRunnerDeps {
  providerRegistry: ProviderDefinition[];
  providerConfigRepo?: Pick<ProviderConfigRepo, "get">;
  commandRunner?: CommandRunner;
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```$/);
  return fenced ? fenced[1]!.trim() : trimmed;
}

function extractBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function extractTextFromCodexJsonl(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let latestText: string | null = null;
  for (const line of lines) {
    let event: {
      type?: string;
      item?: { type?: string; text?: string };
    };

    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      return null;
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      latestText = event.item.text ?? "";
    }
  }

  return latestText;
}

function extractTextFromClaudeJson(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!) as { result?: unknown };
      if (typeof parsed.result === "string" && parsed.result.trim()) {
        return parsed.result.trim();
      }
    } catch {
      continue;
    }
  }

  return null;
}

function parseResultFromStdout(stdout: string, providerId: string): SessionAnalysisResult {
  const rawCandidates = [
    stdout.trim(),
    extractTextFromCodexJsonl(stdout),
    extractTextFromClaudeJson(stdout),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const candidate of rawCandidates) {
    const normalized = stripCodeFence(candidate);
    const objectText = extractBalancedObject(normalized) ?? normalized;
    try {
      return sessionAnalysisResultSchema.parse(JSON.parse(objectText));
    } catch {
      continue;
    }
  }

  throw {
    code: "session_analysis_parse_failed",
    message: `Session analysis output was not valid JSON for provider: ${providerId}`,
  };
}

export function buildSessionAnalysisDigest(input: {
  transcript: string;
  context: SessionAnalysisContext;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input.context))
    .update("\n")
    .update(input.transcript)
    .digest("hex");
}

export class SessionAnalysisRunner {
  private readonly commandRunner: CommandRunner;

  constructor(private readonly deps: SessionAnalysisRunnerDeps) {
    this.commandRunner = deps.commandRunner ?? runCommandAsString;
  }

  async run(input: {
    providerId: string;
    sessionId: string;
    workspacePath: string;
    transcript: string;
    context: SessionAnalysisContext;
  }): Promise<SessionAnalysisResult> {
    const provider = this.deps.providerRegistry.find((entry) => entry.id === input.providerId);
    if (!provider?.headless?.supportedScenarios.includes("session_analysis")) {
      throw {
        code: "session_analysis_provider_unsupported",
        message: `Provider does not support session analysis: ${input.providerId}`,
      };
    }

    const providerConfig = mergeProviderLaunchConfig(
      provider,
      this.deps.providerConfigRepo?.get(provider.id)
    );
    const prompt = buildSessionAnalysisPrompt({
      transcript: input.transcript,
      context: input.context,
    });
    const command = provider.headless.buildCommand(providerConfig, "session_analysis", {
      prompt,
      sessionId: input.sessionId,
      workspacePath: input.workspacePath,
      model:
        typeof providerConfig.model === "string" && providerConfig.model.trim()
          ? providerConfig.model
          : undefined,
    });

    if (!command) {
      throw {
        code: "session_analysis_provider_unsupported",
        message: `Provider returned no headless command for session analysis: ${input.providerId}`,
      };
    }

    const { stdout } = await this.commandRunner(command.argv[0]!, command.argv.slice(1), {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      windowsHide: true,
    });

    return parseResultFromStdout(stdout, provider.id);
  }
}
