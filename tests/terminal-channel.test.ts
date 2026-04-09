import test from "node:test";
import assert from "node:assert/strict";
import { buildTerminalChannelInput } from "../apps/web/src/services/terminal-channel/client.ts";

test("buildTerminalChannelInput creates terminal channel message with controller identity and fencing context", () => {
  assert.deepEqual(
    buildTerminalChannelInput("ws-1", "device-1", "client-1", 7, "runtime-1", "pwd\r"),
    {
      type: "terminal_channel_input",
      workspace_id: "ws-1",
      device_id: "device-1",
      client_id: "client-1",
      fencing_token: 7,
      runtime_id: "runtime-1",
      input: "pwd\r",
    },
  );
});
