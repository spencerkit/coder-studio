type AgentInstructionsParseError = {
  code: "agent_instructions_parse_failed";
  message: string;
};

type JsonRecord = Record<string, unknown>;

function createParseError(message: string): AgentInstructionsParseError {
  return {
    code: "agent_instructions_parse_failed",
    message,
  };
}

function unwrapCodeFence(content: string): string {
  const trimmed = content.trim();
  return trimmed.match(/^```[^\n`]*\n([\s\S]*?)\n```$/)?.[1] ?? trimmed;
}

function parseJsonRecord(raw: string, context: string): JsonRecord {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw createParseError(`${context} must be a JSON object`);
    }
    return parsed as JsonRecord;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "agent_instructions_parse_failed"
    ) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Unknown JSON parse failure";
    throw createParseError(`${context} contained invalid JSON: ${message}`);
  }
}

function tryParseJsonRecord(raw: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as JsonRecord;
  } catch {
    return null;
  }
}

function extractEnvelopeResultText(providerId: string, record: JsonRecord): string | null {
  if (record.is_error === true || record.subtype === "error_during_execution") {
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.result === "string"
          ? record.result
          : typeof record.error === "string"
            ? record.error
            : `${providerId} reported an error in its result envelope`;
    throw createParseError(message);
  }

  if (typeof record.result === "string") {
    return record.result;
  }

  if (typeof record.content === "string") {
    return record.content;
  }

  return null;
}

function extractAgentInstructionsReplyTextFromEnvelope(providerId: string, stdout: string): string {
  const trimmed = stdout.trim();
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = lines.length > 1 ? [trimmed, ...lines.slice().reverse()] : [trimmed];

  for (const candidate of candidates) {
    const record = tryParseJsonRecord(candidate);
    if (!record) {
      continue;
    }

    const result = extractEnvelopeResultText(providerId, record);
    if (typeof result === "string" && result.trim()) {
      return result;
    }
  }

  throw createParseError(`${providerId} output did not contain a recognizable result envelope`);
}

export function normalizeGeneratedAgentInstructionsMarkdown(content: string): string {
  const unwrapped = unwrapCodeFence(content);
  const normalized = `${unwrapped.trim()}\n`;
  const firstLine = normalized.split("\n", 1)[0];

  if (firstLine !== "# Agent Instructions") {
    throw createParseError(
      "Generated content must start with an exact '# Agent Instructions' heading"
    );
  }

  return normalized;
}

export function extractAgentInstructionsReplyText(providerId: string, stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw createParseError("Agent instructions output was empty");
  }

  if (providerId === "codex") {
    const lines = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    let latestText: string | null = null;

    for (const line of lines) {
      let event: {
        type?: string;
        item?: {
          type?: string;
          item_type?: string;
          text?: string;
        };
      };

      try {
        event = JSON.parse(line) as typeof event;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown JSON parse failure";
        throw createParseError(`Codex output contained malformed JSONL: ${message}`);
      }

      const itemType = event.item?.type ?? event.item?.item_type;
      if (event.type === "item.completed" && itemType === "agent_message") {
        latestText = event.item?.text ?? "";
      }
    }

    if (!latestText?.trim()) {
      throw createParseError("Codex output did not contain a completed agent_message");
    }

    return latestText;
  }

  if (providerId === "claude" || providerId === "gemini" || providerId === "cursor") {
    return extractAgentInstructionsReplyTextFromEnvelope(providerId, stdout);
  }

  throw createParseError(`Unsupported agent instructions provider: ${providerId}`);
}

export function parseGeneratedAgentInstructionsPayload(replyText: string): string {
  const payload = parseJsonRecord(
    unwrapCodeFence(replyText),
    "Generated agent instructions payload"
  );

  if (payload.ok === false) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : "Agent instructions generation reported failure";
    throw createParseError(message);
  }

  if (payload.ok !== true) {
    throw createParseError("Generated agent instructions payload must set ok to true");
  }

  if (typeof payload.content !== "string") {
    throw createParseError("Generated agent instructions payload must include a string content");
  }

  return normalizeGeneratedAgentInstructionsMarkdown(payload.content);
}

export function extractAgentInstructionsMarkdownFromCodexJsonl(stdout: string): string {
  const replyText = extractAgentInstructionsReplyText("codex", stdout);
  const unwrapped = unwrapCodeFence(replyText);

  if (unwrapped.startsWith("{")) {
    return parseGeneratedAgentInstructionsPayload(replyText);
  }

  return normalizeGeneratedAgentInstructionsMarkdown(replyText);
}
