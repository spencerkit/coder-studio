import {
  buildIdentifyResult,
  DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  listAutomationCapabilities,
} from "@coder-studio/core";

interface PrintOptions {
  json?: boolean;
}

export function printIdentify(options: PrintOptions = {}): void {
  const result = buildIdentifyResult();

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.insideCoderStudio ? "Inside Coder Studio" : "Not running inside Coder Studio");
}

export function printCapabilities(options: PrintOptions = {}): void {
  const result = {
    version: 1,
    commands: listAutomationCapabilities({
      permissions: DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
    }),
  };

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.commands.map((command) => `${command.name}: ${command.cli}`).join("\n"));
}
