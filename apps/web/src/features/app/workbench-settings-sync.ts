import type { Tab } from "../../state/workbench-core.ts";
import type { AppSettings } from "../../types/app.ts";

const matchesIdlePolicy = (
  left: Tab["idlePolicy"],
  right: AppSettings["idlePolicy"],
) => (
  left.enabled === right.enabled
  && left.idleMinutes === right.idleMinutes
  && left.maxActive === right.maxActive
  && left.pressure === right.pressure
);

const matchesAgentSettings = (
  tab: Tab,
  settings: AppSettings,
) => (
  tab.agent.provider === settings.agentProvider
  && tab.agent.command === settings.agentCommand
);

export const summarizeWorkbenchSettingsSync = (
  tabs: Tab[],
  settings: AppSettings,
) => {
  const agentWorkspaceIds = tabs
    .filter((tab) => !matchesAgentSettings(tab, settings))
    .map((tab) => tab.id);
  const idlePolicyWorkspaceIds = tabs
    .filter((tab) => !matchesIdlePolicy(tab.idlePolicy, settings.idlePolicy))
    .map((tab) => tab.id);

  return {
    agentWorkspaceIds,
    idlePolicyWorkspaceIds,
  };
};

export const applyAppSettingsToTabs = (
  tabs: Tab[],
  settings: AppSettings,
) => tabs.map((tab) => {
  const nextAgent = matchesAgentSettings(tab, settings)
    ? tab.agent
    : {
        ...tab.agent,
        provider: settings.agentProvider,
        command: settings.agentCommand,
      };
  const nextIdlePolicy = matchesIdlePolicy(tab.idlePolicy, settings.idlePolicy)
    ? tab.idlePolicy
    : { ...settings.idlePolicy };

  if (nextAgent === tab.agent && nextIdlePolicy === tab.idlePolicy) {
    return tab;
  }

  return {
    ...tab,
    agent: nextAgent,
    idlePolicy: nextIdlePolicy,
  };
});
