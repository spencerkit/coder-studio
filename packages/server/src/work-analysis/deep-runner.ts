import type { ProviderDefinition } from "@coder-studio/core";
import { mergeProviderLaunchConfig } from "../provider-config.js";
import { type CommandRunner, runCommandAsString } from "../provider-runtime/command-runner.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { buildWorkDeepAnalysisPrompt } from "./deep-prompt.js";
import { workDeepAnalysisResultSchema } from "./deep-schema.js";
import type {
  WorkAnalysisEvidence,
  WorkBasicAnalysisResult,
  WorkDeepAnalysisResult,
} from "./types.js";

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
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
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

function parseDeepResult(stdout: string, providerId: string): WorkDeepAnalysisResult {
  const rawCandidates = [
    stdout.trim(),
    extractTextFromCodexJsonl(stdout),
    extractTextFromClaudeJson(stdout),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const candidate of rawCandidates) {
    const normalized = stripCodeFence(candidate);
    const objectText = extractBalancedObject(normalized) ?? normalized;
    try {
      return workDeepAnalysisResultSchema.parse(JSON.parse(objectText));
    } catch {
      continue;
    }
  }

  throw {
    code: "work_analysis_parse_failed",
    message: `Work analysis output was not valid JSON for provider: ${providerId}`,
  };
}

export interface WorkDeepAnalysisRunnerDeps {
  providerRegistry: ProviderDefinition[];
  providerConfigRepo?: Pick<ProviderConfigRepo, "get">;
  commandRunner?: CommandRunner;
}

export class WorkDeepAnalysisRunner {
  private readonly commandRunner: CommandRunner;

  constructor(private readonly deps: WorkDeepAnalysisRunnerDeps) {
    this.commandRunner = deps.commandRunner ?? runCommandAsString;
  }

  resolveProviderId(preferredProviderId?: string): string {
    const supportedProviders = this.deps.providerRegistry.filter((entry) =>
      entry.headless?.supportedScenarios.includes("session_analysis")
    );
    if (preferredProviderId) {
      const preferred = supportedProviders.find((entry) => entry.id === preferredProviderId);
      if (preferred) {
        return preferred.id;
      }
    }
    if (supportedProviders[0]) {
      return supportedProviders[0].id;
    }
    throw {
      code: "work_analysis_provider_unavailable",
      message: "No provider was available for deep work analysis",
    };
  }

  async run(input: {
    providerId?: string;
    sessionId: string;
    workspacePath: string;
    basicResult: WorkBasicAnalysisResult;
    evidence: WorkAnalysisEvidence;
  }): Promise<WorkDeepAnalysisResult> {
    const resolvedProviderId = this.resolveProviderId(input.providerId);
    const provider = this.deps.providerRegistry.find((entry) => entry.id === resolvedProviderId)!;
    const headless = provider.headless!;

    const providerConfig = mergeProviderLaunchConfig(
      provider,
      this.deps.providerConfigRepo?.get(provider.id)
    );
    const prompt = buildWorkDeepAnalysisPrompt({
      basicResult: input.basicResult,
      evidence: input.evidence,
    });
    const command = headless.buildCommand(providerConfig, "session_analysis", {
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
        code: "work_analysis_provider_unsupported",
        message: `Provider returned no headless command for deep work analysis: ${input.providerId}`,
      };
    }

    const { stdout } = await this.commandRunner(command.argv[0]!, command.argv.slice(1), {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      windowsHide: true,
    });

    return parseDeepResult(stdout, provider.id);
  }
}
