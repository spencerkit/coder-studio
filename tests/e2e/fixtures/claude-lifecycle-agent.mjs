const endpoint = process.env.CODER_STUDIO_HOOK_ENDPOINT;
const workspaceId = process.env.CODER_STUDIO_WORKSPACE_ID;
const sessionId = process.env.CODER_STUDIO_SESSION_ID;
const argv = process.argv.slice(2);

const findArgValue = (flag) => {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
};

const runningDelayMs = Number(findArgValue("--running-delay-ms") || process.env.CODER_STUDIO_TEST_RUNNING_DELAY_MS || 1600);
const stoppedDelayMs = Number(findArgValue("--stopped-delay-ms") || process.env.CODER_STUDIO_TEST_STOPPED_DELAY_MS || 400);

if (!endpoint || !workspaceId || !sessionId) {
  console.error("missing coder studio hook env");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveClaudeSessionId = () => {
  const resumeValue = findArgValue("--resume");
  if (resumeValue) {
    return resumeValue;
  }

  const skipNextForFlags = new Set(["--resume", "--running-delay-ms", "--stopped-delay-ms"]);
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (skipNextForFlags.has(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith("--")) {
      return value;
    }
  }
  return process.env.CODER_STUDIO_TEST_CLAUDE_SESSION_ID || "claude-e2e-session";
};

const claudeSessionId = resolveClaudeSessionId();

const postHook = async (hookEventName, extra = {}) => {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      session_id: sessionId,
      payload: {
        hook_event_name: hookEventName,
        session_id: claudeSessionId,
        ...extra,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`hook ${hookEventName} failed with ${response.status}`);
  }
};

const main = async () => {
  process.stdout.write(`argv:${argv.join(" ")}\n`);
  await postHook("SessionStart");
  await sleep(80);
  await postHook("PreToolUse", { tool_name: "Edit" });
  process.stdout.write("fixture-running\n");
  await sleep(runningDelayMs);
  await postHook("Stop");
  process.stdout.write("fixture-stopped\n");
  await sleep(stoppedDelayMs);
};

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
