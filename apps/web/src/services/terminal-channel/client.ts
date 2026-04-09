import type { TerminalChannelOutputEvent } from "../../types/app.ts";

export const buildTerminalChannelInput = (
  workspaceId: string,
  deviceId: string,
  clientId: string,
  fencingToken: number,
  runtimeId: string,
  input: string,
) => ({
  type: "terminal_channel_input" as const,
  workspace_id: workspaceId,
  device_id: deviceId,
  client_id: clientId,
  fencing_token: fencingToken,
  runtime_id: runtimeId,
  input,
});

export const sendTerminalChannelInput = (
  workspaceId: string,
  deviceId: string,
  clientId: string,
  fencingToken: number,
  runtimeId: string,
  input: string,
) => {
  void import("../../ws/client.ts").then(({ sendWsMessage }) => {
    sendWsMessage(buildTerminalChannelInput(
      workspaceId,
      deviceId,
      clientId,
      fencingToken,
      runtimeId,
      input,
    ));
  });
};

export const subscribeTerminalChannelOutput = (
  handler: (payload: TerminalChannelOutputEvent) => void,
) => {
  let unsubscribe = () => {};
  void import("../../ws/client.ts").then(({ subscribeWsEvent }) => {
    unsubscribe = subscribeWsEvent<TerminalChannelOutputEvent>("terminal://channel_output", handler);
  });
  return () => unsubscribe();
};
