import test from "node:test";
import assert from "node:assert/strict";

import {
  sendWsMutationWithHttpFallback,
  sendWsMutationWithNullableHttpFallback,
} from "../apps/web/src/services/http/ws-rpc-fallback";

test("sendWsMutationWithHttpFallback prefers websocket when available", async () => {
  const calls: string[] = [];

  await sendWsMutationWithHttpFallback(
    () => {
      calls.push("ws");
      return true;
    },
    async () => {
      calls.push("http");
    },
  );

  assert.deepEqual(calls, ["ws"]);
});

test("sendWsMutationWithHttpFallback falls back to http when websocket send fails", async () => {
  const calls: string[] = [];

  await sendWsMutationWithHttpFallback(
    () => {
      calls.push("ws");
      return false;
    },
    async () => {
      calls.push("http");
    },
  );

  assert.deepEqual(calls, ["ws", "http"]);
});

test("sendWsMutationWithHttpFallback falls back to http when websocket send throws", async () => {
  const calls: string[] = [];

  await sendWsMutationWithHttpFallback(
    () => {
      calls.push("ws");
      throw new Error("socket unavailable");
    },
    async () => {
      calls.push("http");
    },
  );

  assert.deepEqual(calls, ["ws", "http"]);
});

test("sendWsMutationWithNullableHttpFallback returns null when websocket send succeeds", async () => {
  const result = await sendWsMutationWithNullableHttpFallback(
    () => true,
    async () => "http-result",
  );

  assert.equal(result, null);
});

test("sendWsMutationWithNullableHttpFallback returns the http result when websocket send fails", async () => {
  const result = await sendWsMutationWithNullableHttpFallback(
    () => false,
    async () => "http-result",
  );

  assert.equal(result, "http-result");
});
