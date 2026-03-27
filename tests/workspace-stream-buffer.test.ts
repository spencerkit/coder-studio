import test from "node:test";
import assert from "node:assert/strict";
import {
  appendBoundedMessage,
  appendBufferedText,
} from "../apps/web/src/features/workspace/workspace-stream-buffer.ts";

test("appendBufferedText keeps the latest tail within the limit", () => {
  assert.equal(
    appendBufferedText("abcdef", "ghijkl", 8),
    "efghijkl",
  );
});

test("appendBufferedText keeps the current value when chunk is empty", () => {
  assert.equal(
    appendBufferedText("abcdef", "", 8),
    "abcdef",
  );
});

test("appendBoundedMessage appends new messages and drops the oldest overflow", () => {
  const next = appendBoundedMessage([
    { id: "1", role: "system", content: "one", time: "10:00" },
    { id: "2", role: "system", content: "two", time: "10:01" },
  ], {
    id: "3",
    role: "system",
    content: "three",
    time: "10:02",
  }, 2);

  assert.deepEqual(next.map((message) => message.id), ["2", "3"]);
});

test("appendBoundedMessage leaves messages unchanged when there is no message", () => {
  const messages = [{ id: "1", role: "system", content: "one", time: "10:00" }];
  assert.equal(appendBoundedMessage(messages, null, 2), messages);
});
