import test from "node:test";
import assert from "node:assert/strict";
import { sessionHeaderTag } from "../apps/web/src/shared/utils/session.ts";

test("sessionHeaderTag returns a running badge for active sessions", () => {
  assert.deepEqual(sessionHeaderTag("running", "en"), {
    label: "Running",
    tone: "active",
  });
});

test("sessionHeaderTag returns a queued badge for waiting sessions", () => {
  assert.deepEqual(sessionHeaderTag("waiting", "en"), {
    label: "Queued",
    tone: "queue",
  });
});

test("sessionHeaderTag returns a ready badge for idle sessions", () => {
  assert.deepEqual(sessionHeaderTag("idle", "en"), {
    label: "Ready",
    tone: "idle",
  });
});
