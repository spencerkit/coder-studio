import { getTerminalBrokerSocketPath } from "@coder-studio/core/runtime";
import { EventBus, startTerminalBrokerServer } from "@coder-studio/server";

export const runTerminalBrokerEntrypoint = async (): Promise<void> => {
  await startTerminalBrokerServer({
    endpoint: process.env.CODER_STUDIO_TERMINAL_BROKER_ENDPOINT ?? getTerminalBrokerSocketPath(),
    eventBus: new EventBus(),
  });
};

void runTerminalBrokerEntrypoint().catch((error) => {
  console.error("Terminal broker failed to start:", error);
  process.exit(1);
});
