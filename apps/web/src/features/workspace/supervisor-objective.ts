const SUPERVISOR_PROMPT_PREFIX = [
  "You are the supervisor for a business agent terminal session.",
  "Your job is to read the active goal, the latest turn context, and produce the next message that should be sent to the business agent.",
  "Stay aligned with the user's intent. Do not redesign the product scope.",
].join("\n");

export const normalizeSupervisorObjective = (objectiveText: string) => objectiveText.trim();

export const composeSupervisorObjectivePreview = (objectiveText: string) => {
  const normalized = normalizeSupervisorObjective(objectiveText);
  if (!normalized) {
    return "";
  }

  return `${SUPERVISOR_PROMPT_PREFIX}\n\nActive objective:\n${normalized}\n`;
};
