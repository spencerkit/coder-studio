import type { WorkLogEvent } from "./log-sources/types.js";
import { extractSkillNameFromEvent } from "./skill-attribution.js";

const MAX_INDEX_EVENT_TEXT_LENGTH = 500;
const MAX_INDEX_EVENT_COMMAND_TEXT_LENGTH = 1_000;
const MAX_INDEX_EVENT_PATH_LENGTH = 1_000;
const MAX_INDEX_EVENT_RAW_REF_LENGTH = 1_000;
const MAX_INDEX_EVENT_RAW_REFS = 3;

export function compactWorkLogEventForHourlyIndex(event: WorkLogEvent): WorkLogEvent {
  const skillName = extractSkillNameFromEvent(event);

  return {
    eventId: event.eventId,
    providerId: event.providerId,
    sessionId: event.sessionId,
    workspacePath: event.workspacePath,
    eventType: event.eventType,
    canonicalEventType: event.canonicalEventType,
    ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }),
    ...(event.timestampQuality === undefined ? {} : { timestampQuality: event.timestampQuality }),
    ...(event.role === undefined ? {} : { role: event.role }),
    ...(event.modelId === undefined ? {} : { modelId: compactString(event.modelId) }),
    ...(event.turnIdHint === undefined ? {} : { turnIdHint: compactString(event.turnIdHint) }),
    ...(event.toolName === undefined ? {} : { toolName: compactString(event.toolName) }),
    ...(event.toolCategory === undefined ? {} : { toolCategory: event.toolCategory }),
    ...(skillName === undefined ? {} : { skillName }),
    ...(event.commandText === undefined
      ? {}
      : { commandText: compactString(event.commandText, MAX_INDEX_EVENT_COMMAND_TEXT_LENGTH) }),
    ...(event.commandKind === undefined ? {} : { commandKind: compactString(event.commandKind) }),
    ...(event.text === undefined
      ? {}
      : { text: compactString(event.text, MAX_INDEX_EVENT_TEXT_LENGTH) }),
    ...(event.filePath === undefined
      ? {}
      : { filePath: compactString(event.filePath, MAX_INDEX_EVENT_PATH_LENGTH) }),
    ...(event.tokenUsage === undefined ? {} : { tokenUsage: { ...event.tokenUsage } }),
    rawRefs: compactRawRefs(event.rawRefs),
  };
}

function compactString(value: string, maxLength = MAX_INDEX_EVENT_TEXT_LENGTH): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function compactRawRefs(rawRefs: string[]): string[] {
  return rawRefs
    .slice(0, MAX_INDEX_EVENT_RAW_REFS)
    .map((rawRef) => compactString(rawRef, MAX_INDEX_EVENT_RAW_REF_LENGTH));
}
