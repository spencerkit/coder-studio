import {
  type ProviderConfig,
  type ProviderDefinition,
  providerSupportsAgentInstructionsGeneration,
} from "@coder-studio/core";
import { type CommandRunner, runCommandAsString } from "../provider-runtime/command-runner.js";
import type { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { inspectWorkspaceIntelligence } from "../workspace/intelligence.js";
import {
  extractAgentInstructionsReplyText,
  parseGeneratedAgentInstructionsPayload,
} from "./output.js";
import { buildAgentInstructionsGenerationPrompt } from "./prompt.js";

type AgentInstructionsGenerationError = {
  code:
    | "agent_instructions_generation_failed"
    | "agent_instructions_generation_timeout"
    | "agent_instructions_generation_no_output";
  message: string;
  details?: {
    providerId?: string;
    stderr?: string;
    exitCode?: number;
    timeoutMs?: number;
  };
};

export interface AgentInstructionsGenerationResult {
  content: string;
  meta: {
    providerId: string;
    model?: string;
  };
}

export interface AgentInstructionsGeneratorDeps {
  providerConfigRepo?: Pick<ProviderConfigRepo, "get">;
  commandRunner?: CommandRunner;
}

export interface AgentInstructionsGenerationRequest {
  providerId?: string;
  model?: string;
}

const AGENT_INSTRUCTIONS_GENERATION_TIMEOUT_MS = 120_000;

export class AgentInstructionsGenerator {
  private readonly commandRunner: CommandRunner;

  constructor(private readonly deps: AgentInstructionsGeneratorDeps = {}) {
    this.commandRunner = deps.commandRunner ?? runCommandAsString;
  }

  async generate(
    workspaceId: string,
    rootPath: string,
    providerRegistry: ProviderDefinition[],
    request: AgentInstructionsGenerationRequest = {}
  ): Promise<AgentInstructionsGenerationResult> {
    const model = this.normalizeModel(request.model);
    const provider = this.resolveProvider(providerRegistry, request.providerId);

    try {
      const summary = await inspectWorkspaceIntelligence({
        workspaceId,
        rootPath,
      });
      const prompt = buildAgentInstructionsGenerationPrompt(summary);
      const providerConfig = this.resolveProviderConfig(provider);
      const command = provider.headless!.buildCommand(
        providerConfig,
        "agent_instructions_generate",
        {
          prompt,
          sessionId: `agent-instructions-${workspaceId}`,
          workspacePath: rootPath,
          model,
        }
      );

      if (!command) {
        throw this.createUnsupportedProviderError(provider.id);
      }

      const { stdout } = await this.commandRunner(command.argv[0]!, command.argv.slice(1), {
        cwd: command.cwd,
        env: { ...process.env, ...command.env },
        windowsHide: true,
        timeoutMs: AGENT_INSTRUCTIONS_GENERATION_TIMEOUT_MS,
      });
      const replyText = extractAgentInstructionsReplyText(provider.id, stdout);
      const content = parseGeneratedAgentInstructionsPayload(replyText);

      return {
        content,
        meta: {
          providerId: provider.id,
          model,
        },
      };
    } catch (error) {
      if (this.isTypedError(error, "agent_instructions_provider_unsupported")) {
        throw error;
      }

      if (this.isTypedError(error, "agent_instructions_parse_failed")) {
        if ((error as { message?: string }).message === "Agent instructions output was empty") {
          throw this.createGenerationFailedError(provider.id, error);
        }
        throw error;
      }

      throw this.createGenerationFailedError(provider.id, error);
    }
  }

  private resolveProvider(
    providerRegistry: ProviderDefinition[],
    requestedProviderId?: string
  ): ProviderDefinition {
    if (requestedProviderId) {
      const requestedProvider = providerRegistry.find((entry) => entry.id === requestedProviderId);
      if (!requestedProvider || !providerSupportsAgentInstructionsGeneration(requestedProvider)) {
        throw this.createUnsupportedProviderError(requestedProviderId);
      }

      return requestedProvider;
    }

    const provider = providerRegistry.find((entry) =>
      providerSupportsAgentInstructionsGeneration(entry)
    );
    if (!provider) {
      throw this.createUnsupportedProviderError();
    }

    return provider;
  }

  private normalizeModel(model?: string): string | undefined {
    const trimmed = model?.trim();
    return trimmed ? trimmed : undefined;
  }

  private resolveProviderConfig(provider: ProviderDefinition): ProviderConfig {
    const savedConfig = this.deps.providerConfigRepo?.get(provider.id);
    return provider.configSchema.parse({
      ...(provider.defaultConfig ?? {}),
      ...(savedConfig ?? {}),
    });
  }

  private createUnsupportedProviderError(providerId?: string) {
    return {
      code: "agent_instructions_provider_unsupported",
      message: providerId
        ? `Provider does not support agent-instructions generation: ${providerId}`
        : "No provider supports agent-instructions generation",
    };
  }

  private createGenerationFailedError(
    providerId: string,
    error: unknown
  ): AgentInstructionsGenerationError {
    const candidate = error as {
      code?: string;
      message?: string;
      stderr?: string;
      exitCode?: number;
      timeoutMs?: number;
    };

    if (candidate.code === "command_timeout") {
      return {
        code: "agent_instructions_generation_timeout",
        message: `Timed out waiting for ${providerId} to generate agent instructions`,
        details: {
          providerId,
          stderr: candidate.stderr,
          timeoutMs: candidate.timeoutMs,
        },
      };
    }

    if (candidate.code === "agent_instructions_parse_failed") {
      if (candidate.message === "Agent instructions output was empty") {
        return {
          code: "agent_instructions_generation_no_output",
          message: `${providerId} returned no output for agent instructions generation`,
          details: {
            providerId,
          },
        };
      }
    }

    return {
      code: "agent_instructions_generation_failed",
      message:
        candidate.message ?? `Agent instructions generation failed for provider: ${providerId}`,
      details: {
        providerId,
        stderr: candidate.stderr,
        exitCode: candidate.exitCode,
      },
    };
  }

  private isTypedError(codeCandidate: unknown, code: string): boolean {
    return (
      typeof codeCandidate === "object" &&
      codeCandidate !== null &&
      "code" in codeCandidate &&
      (codeCandidate as { code?: string }).code === code
    );
  }
}
