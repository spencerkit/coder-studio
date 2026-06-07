export interface RetryToolStep {
  tool: string;
  file?: string;
  command?: string;
}

const VERIFY_TOOL_PATTERN = /^(bash|bashtool|powershelltool|shell|command)$/i;
const EDIT_TOOL_PATTERN = /^(edit|write|fileedittool|filewritetool|notebookedit|cursor:edit)$/i;

export function countTurnRetries(steps: RetryToolStep[]) {
  const lastEditStep = new Map<string, number>();
  let lastVerifyStep = -1;
  let retries = 0;

  for (const [index, step] of steps.entries()) {
    if (VERIFY_TOOL_PATTERN.test(step.tool)) {
      lastVerifyStep = index;
    }

    if (!EDIT_TOOL_PATTERN.test(step.tool)) {
      continue;
    }

    const key = normalizeRetryKey(step.file);
    const previousEditIndex = lastEditStep.get(key);
    if (
      previousEditIndex !== undefined &&
      lastVerifyStep > previousEditIndex &&
      lastVerifyStep < index
    ) {
      retries += 1;
    }

    lastEditStep.set(key, index);
  }

  return retries;
}

function normalizeRetryKey(filePath: string | undefined) {
  if (typeof filePath !== "string") {
    return "__no_file__";
  }

  const trimmed = filePath.trim();
  return trimmed.length > 0 ? trimmed : "__no_file__";
}
