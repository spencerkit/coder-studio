import type { UiActionEvent, UiActionIntent } from "@coder-studio/core";

export type UiActionExecutor = (event: UiActionEvent) => Promise<void> | void;

export interface UiActionRegistry {
  execute(event: UiActionEvent): Promise<void>;
  register(type: UiActionIntent["type"], executor: UiActionExecutor): () => void;
}

const ALLOWED_FRONTEND_COMMANDS = new Set(["quickOpen.open", "commandPalette.open"]);

export function isAllowedFrontendUiCommand(commandId: string): boolean {
  return ALLOWED_FRONTEND_COMMANDS.has(commandId);
}

export function createUiActionRegistry(): UiActionRegistry {
  const executors = new Map<UiActionIntent["type"], UiActionExecutor>();

  return {
    register(type, executor) {
      executors.set(type, executor);
      return () => {
        if (executors.get(type) === executor) {
          executors.delete(type);
        }
      };
    },
    async execute(event) {
      const executor = executors.get(event.intent.type);
      if (!executor) {
        throw new Error(`No UI action executor registered for ${event.intent.type}`);
      }
      await executor(event);
    },
  };
}
