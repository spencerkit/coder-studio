import test from "node:test";
import assert from "node:assert/strict";
import { sessionHeaderTag } from "../apps/web/src/shared/utils/session";

test("sessionHeaderTag returns a running badge for active sessions", () => {
  assert.deepEqual(sessionHeaderTag("running", "en"), {
    label: "running",
    tone: "active",
  });
});

test("sessionHeaderTag returns an interrupted badge for interrupted sessions", () => {
  assert.deepEqual(sessionHeaderTag("interrupted", "en"), {
    label: "interrupted",
    tone: "muted",
  });
});

test("sessionHeaderTag returns a ready badge for idle sessions", () => {
  assert.deepEqual(sessionHeaderTag("idle", "en"), {
    label: "ready",
    tone: "idle",
  });
});

test("sessionHeaderTag returns an archived badge for archive views", () => {
  assert.deepEqual(sessionHeaderTag("archived", "en"), {
    label: "historyArchived",
    tone: "muted",
  });
});
