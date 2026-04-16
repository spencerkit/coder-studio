import Anthropic from '@anthropic-ai/sdk';

export interface EvaluationResult {
  progress: number;
  summary: string;
  guidance?: string;
  shouldInject: boolean;
}

const EVALUATION_SYSTEM_PROMPT = `You are a supervisor evaluating an AI coding agent's progress toward a stated objective.

Analyze the terminal output and optional git diff to assess:
1. How much progress has been made (0-100%)
2. A brief summary of what's been accomplished
3. Whether the agent needs guidance to stay on track

Respond with ONLY valid JSON:
{
  "progress": <number 0-100>,
  "summary": "<brief summary>",
  "shouldInject": <boolean>,
  "guidance": "<optional guidance if shouldInject is true>"
}`;

export async function evaluateProgress(
  objective: string,
  terminalOutput: string,
  gitDiff?: string
): Promise<EvaluationResult> {
  const client = new Anthropic();

  const userContent = [
    `**Objective:** ${objective}`,
    `**Terminal Output (last lines):**\n\`\`\`\n${terminalOutput}\n\`\`\``,
    gitDiff ? `**Git Diff:**\n\`\`\`\n${gitDiff}\n\`\`\`` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: EVALUATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const parsed = JSON.parse(text) as EvaluationResult;
    return {
      progress: Math.max(0, Math.min(100, parsed.progress)),
      summary: parsed.summary || 'No summary available',
      shouldInject: parsed.shouldInject ?? false,
      guidance: parsed.guidance,
    };
  } catch {
    return {
      progress: 0,
      summary: 'Failed to parse evaluation response',
      shouldInject: false,
    };
  }
}