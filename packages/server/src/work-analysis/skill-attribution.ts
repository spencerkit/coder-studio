import type { WorkLogEvent } from "./log-sources/types.js";

export const UNKNOWN_SKILL_KEY = "unknown-skill";
export const UNKNOWN_SKILL_LABEL = "未知 Skill";

const SKILL_NAME_FIELDS = [
  "skill",
  "skillName",
  "skill_name",
  "skillSlug",
  "skill_slug",
  "slug",
  "name",
] as const;

const SKILL_PAYLOAD_FIELDS = ["input", "arguments", "payload", "toolInput", "tool_input"] as const;

export function extractSkillNameFromEvent(event: Pick<WorkLogEvent, "payload" | "skillName">) {
  return takeSkillName(event.skillName) ?? takeSkillName(event.payload);
}

export function extractSkillNameFromPayload(payload: unknown) {
  return takeSkillName(payload);
}

function takeSkillName(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value === undefined || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    const parsed = parseJsonObject(value);
    if (parsed) {
      return takeSkillName(parsed, depth + 1);
    }

    return normalizeSkillName(value);
  }

  if (typeof value !== "object") {
    return undefined;
  }

  for (const field of SKILL_NAME_FIELDS) {
    const skillName = normalizeSkillName(Reflect.get(value, field));
    if (skillName) {
      return skillName;
    }
  }

  for (const field of SKILL_PAYLOAD_FIELDS) {
    const skillName = takeSkillName(Reflect.get(value, field), depth + 1);
    if (skillName) {
      return skillName;
    }
  }

  return undefined;
}

function normalizeSkillName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.toLowerCase() === "skill") {
    return undefined;
  }

  return trimmed.slice(0, 160);
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
