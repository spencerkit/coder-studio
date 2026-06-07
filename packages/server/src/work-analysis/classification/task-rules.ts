import type { WorkAnalysisTaskType } from "../types.js";

export const EDIT_TOOL_NAMES = new Set([
  "Edit",
  "Write",
  "FileEditTool",
  "FileWriteTool",
  "NotebookEdit",
  "cursor:edit",
]);

export const READ_TOOL_NAMES = new Set([
  "Read",
  "Grep",
  "Glob",
  "FileReadTool",
  "GrepTool",
  "GlobTool",
]);

export const BASH_TOOL_NAMES = new Set(["Bash", "BashTool", "PowerShellTool", "shell", "command"]);

export const TASK_TOOL_NAMES = new Set([
  "TaskCreate",
  "TaskUpdate",
  "TaskGet",
  "TaskList",
  "TaskOutput",
  "TaskStop",
  "TodoWrite",
]);

export const SEARCH_TOOL_NAMES = new Set(["WebSearch", "WebFetch", "ToolSearch"]);

export const TEST_PATTERNS =
  /\b(test|pytest|vitest|jest|mocha|spec|coverage|npm\s+test|pnpm\s+test|npx\s+vitest|npx\s+jest)\b/i;
export const GIT_PATTERNS =
  /\bgit\s+(push|pull|commit|merge|rebase|checkout|branch|stash|log|diff|status|add|reset|cherry-pick|tag)\b/i;
export const BUILD_PATTERNS =
  /\b(npm\s+run\s+build|pnpm\s+build|yarn\s+build|npm\s+publish|docker|deploy|make\s+build|npm\s+run\s+dev|npm\s+start|pm2|systemctl|cargo\s+build|go\s+build)\b/i;
export const INSTALL_PATTERNS =
  /\b(npm\s+install|pnpm\s+add|yarn\s+add|pip\s+install|brew\s+install|apt\s+install|cargo\s+add)\b/i;

export const FEATURE_KEYWORDS =
  /\b(add|create|implement|new|build|feature|introduce|set\s*up|scaffold|generate|make\s+(?:a|me|the)|write\s+(?:a|me|the))\b/i;
export const DEBUG_KEYWORDS =
  /\b(fix|bug|error|broken|failing|crash|issue|debug|traceback|exception|stack\s*trace|not\s+working|wrong|unexpected|status\s+code|404|500|401|403)\b/i;
export const REFACTOR_KEYWORDS =
  /\b(refactor|clean\s*up|cleanup|rename|reorganize|simplify|extract|restructure|move|migrate|split)\b/i;
export const RESEARCH_KEYWORDS =
  /\b(research|investigate|look\s+into|find\s+out|check|search|analyze|review|understand|explain|how\s+does|what\s+is|show\s+me|list|compare|verify)\b/i;
export const BRAINSTORM_KEYWORDS =
  /\b(brainstorm|idea|what\s+if|explore|think\s+about|approach|strategy|design|consider|how\s+should|what\s+would|opinion|suggest|recommend)\b/i;

export const FILE_PATTERNS =
  /\.(py|js|ts|tsx|jsx|json|yaml|yml|toml|sql|sh|go|rs|java|rb|php|css|html|md|csv|xml)\b/i;
export const SCRIPT_PATTERNS =
  /\b(run\s+\S+\.\w+|execute|scrip?t|curl|api\s+\S+|endpoint|request\s+url|fetch\s+\S+|query|database|db\s+\S+)\b/i;
export const URL_PATTERN = /https?:\/\/\S+/i;

export function firstMatchingCategory(
  text: string,
  candidates: ReadonlyArray<{ regex: RegExp; category: WorkAnalysisTaskType }>
): WorkAnalysisTaskType | null {
  let best: { index: number; order: number; category: WorkAnalysisTaskType } | null = null;

  for (const [index, candidate] of candidates.entries()) {
    const match = candidate.regex.exec(text);
    if (!match) {
      continue;
    }

    if (!best || match.index < best.index || (match.index === best.index && index < best.order)) {
      best = { index: match.index, order: index, category: candidate.category };
    }
  }

  return best?.category ?? null;
}
