import { spawn } from 'node:child_process';
import { z } from 'zod';
import type { ProviderDefinition, Supervisor } from '@coder-studio/core';
import type { ProviderConfigRepo } from '../storage/repositories/provider-config-repo.js';
import type { SupervisorEvaluationContext } from './context-builder.js';

const EvalResultSchema = z
  .object({
    progress: z.number(),
    summary: z.string().min(1),
    shouldInject: z.boolean(),
    guidance: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.shouldInject && !value.guidance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'guidance is required when shouldInject=true',
      });
    }
  });

export interface EvaluationResult {
  progress: number;
  summary: string;
  guidance?: string;
  shouldInject: boolean;
  confidence?: number;
}

export class SupervisorEvaluator {
  constructor(
    private readonly deps: {
      providerRegistry: ProviderDefinition[];
      providerConfigRepo: ProviderConfigRepo;
      timeoutMs?: number;
    }
  ) {}

  async evaluate(
    supervisor: Supervisor,
    context: SupervisorEvaluationContext
  ): Promise<EvaluationResult> {
    const provider = this.deps.providerRegistry.find(
      (item) => item.id === supervisor.evaluatorProviderId
    );
    if (!provider?.buildSupervisorEvalCommand) {
      throw {
        code: 'supervisor_invalid_evaluator_provider',
        message: 'Evaluator provider does not support headless eval',
      };
    }

    let config = this.deps.providerConfigRepo.get(provider.id);
    if (!config) {
      config = (provider as Partial<typeof provider>).defaultConfig;
    }
    if (!config) {
      throw {
        code: 'missing_evaluator_config',
        message: `Missing config for evaluator provider ${provider.id}`,
      };
    }

    const prompt = buildPrompt(context);
    const command = provider.buildSupervisorEvalCommand(config, {
      prompt,
      sessionId: supervisor.sessionId,
      workspacePath: context.workspacePath,
      model: typeof config.model === 'string' ? config.model : undefined,
    });

    if (!command) {
      throw {
        code: 'supervisor_invalid_evaluator_provider',
        message: 'Evaluator provider returned null command',
      };
    }

    const stdout = await runCommand(command, this.deps.timeoutMs ?? 30_000);
    const parsed = EvalResultSchema.parse(parseJsonPayload(stdout));

    return {
      progress: Math.max(0, Math.min(100, Math.round(parsed.progress))),
      summary: parsed.summary,
      shouldInject: parsed.shouldInject,
      guidance: parsed.guidance?.slice(0, 2_000),
      confidence: parsed.confidence,
    };
  }
}

function buildPrompt(context: SupervisorEvaluationContext): string {
  return [
    'You are the supervisor evaluator. Return strict JSON only.',
    `Objective: ${context.objective}`,
    `Session provider: ${context.sessionProviderId}`,
    `Evaluator provider: ${context.evaluatorProviderId}`,
    `Session state: ${context.sessionState}`,
    `Evidence source: ${context.evidenceSource}`,
    context.lastTurnId ? `Last turn ID: ${context.lastTurnId}` : '',
    context.transcriptExcerpt
      ? `Transcript:\n${context.transcriptExcerpt}`
      : `Terminal:\n${context.terminalExcerpt ?? ''}`,
    context.gitStatusSummary ? `Git status:\n${context.gitStatusSummary}` : '',
    context.gitDiffStat ? `Git diff stat:\n${context.gitDiffStat}` : '',
    'JSON shape: {"progress":0,"summary":"","shouldInject":false,"guidance":"","confidence":0.0}',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function runCommand(
  command: { argv: string[]; cwd?: string; env?: Record<string, string> },
  timeoutMs: number
): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command.argv[0]!, command.argv.slice(1), {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject({
        code: 'supervisor_eval_timeout',
        message: `Supervisor evaluator timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject({
          code: 'supervisor_eval_failed',
          message:
            Buffer.concat(stderr).toString('utf8').trim() ||
            `Evaluator exited with code ${code}`,
        });
        return;
      }

      resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

function parseJsonPayload(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error('Supervisor evaluator returned empty output');
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Supervisor evaluator did not return valid JSON');
  }
}

// Temporary compatibility shim for the pre-Phase-3 manager path.
export async function evaluateProgress(
  objective: string,
  terminalOutput: string,
  gitDiff?: string
): Promise<EvaluationResult> {
  const evidence = [terminalOutput, gitDiff].filter(Boolean).join('\n').trim();
  const summary = evidence
    ? evidence.split('\n').at(-1) ?? evidence
    : `Awaiting progress on: ${objective}`;

  return {
    progress: 0,
    summary,
    shouldInject: false,
  };
}
