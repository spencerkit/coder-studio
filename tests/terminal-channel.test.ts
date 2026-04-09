import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTerminalChannelInput,
  consumeTerminalChannelInputFragment,
  sanitizeTerminalChannelInput,
  shouldIgnoreTerminalChannelInput,
} from "../apps/web/src/services/terminal-channel/client.ts";

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

test("shouldIgnoreTerminalChannelInput drops xterm focus and terminal self-response sequences", () => {
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b[I"), true);
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b[O"), true);
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b[12;44R"), true);
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b[>0;276;0c"), true);
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b[?64;1;2;6;9;15;18;21;22c"), true);
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b]10;rgb:dddd/dddd/dddd\u0007"), true);
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b]11;rgb:0000/0000/0000\u001b\\"), true);
});

test("sanitizeTerminalChannelInput strips terminal self-response sequences from mixed chunks", () => {
  assert.equal(sanitizeTerminalChannelInput("\u001b[>0;276;0cpwd\r"), "pwd\r");
  assert.equal(sanitizeTerminalChannelInput("ls\u001b[12;44R"), "ls");
  assert.equal(sanitizeTerminalChannelInput("\u001b[I\u001b[O"), null);
  assert.equal(sanitizeTerminalChannelInput("\u001b[>0;276;0c\u001b[12;44R"), null);
});

test("consumeTerminalChannelInputFragment buffers fragmented terminal self-response sequences", () => {
  assert.deepEqual(
    consumeTerminalChannelInputFragment("", "\u001b"),
    { forwarded: null, pending: "\u001b" },
  );
  assert.deepEqual(
    consumeTerminalChannelInputFragment("", "\u001b[>0;"),
    { forwarded: null, pending: "\u001b[>0;" },
  );
  assert.deepEqual(
    consumeTerminalChannelInputFragment("\u001b[>0;", "276;0cpwd\r"),
    { forwarded: "pwd\r", pending: "" },
  );
  assert.deepEqual(
    consumeTerminalChannelInputFragment("", "echo hi\u001b[12;44R"),
    { forwarded: "echo hi", pending: "" },
  );
  assert.deepEqual(
    consumeTerminalChannelInputFragment("\u001b]11;rgb:0000/0000/", "0000\u0007"),
    { forwarded: null, pending: "" },
  );
});

test("shouldIgnoreTerminalChannelInput keeps normal agent input and navigation keys", () => {
  assert.equal(shouldIgnoreTerminalChannelInput("pwd\r"), false);
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b[A"), false);
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b[B"), false);
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b[C"), false);
  assert.equal(shouldIgnoreTerminalChannelInput("\u001b[D"), false);
});
