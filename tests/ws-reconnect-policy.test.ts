import test from "node:test";
import assert from "node:assert/strict";
import {
  getReconnectDelayMs,
  WS_RECONNECT_BASE_DELAY_MS,
  WS_RECONNECT_MAX_DELAY_MS,
} from "../apps/web/src/ws/reconnect-policy.ts";

test("reconnect policy starts at the base delay", () => {
  assert.equal(getReconnectDelayMs(0), WS_RECONNECT_BASE_DELAY_MS);
});

test("reconnect policy doubles delay for consecutive attempts", () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((attempt) => getReconnectDelayMs(attempt)),
    [800, 1600, 3200, 6400],
  );
});

test("reconnect policy caps delay at the max", () => {
  assert.equal(getReconnectDelayMs(4), WS_RECONNECT_MAX_DELAY_MS);
  assert.equal(getReconnectDelayMs(8), WS_RECONNECT_MAX_DELAY_MS);
});

test("reconnect policy clamps invalid attempts to the base delay", () => {
  assert.equal(getReconnectDelayMs(-1), WS_RECONNECT_BASE_DELAY_MS);
  assert.equal(getReconnectDelayMs(Number.NaN), WS_RECONNECT_BASE_DELAY_MS);
});
