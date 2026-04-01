import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBuildPublishedAt,
  readAppBuildMetadata,
} from "../apps/web/src/shared/app/build-metadata.ts";

test("formatBuildPublishedAt renders a stable UTC timestamp", () => {
  assert.equal(
    formatBuildPublishedAt("2026-04-01T08:09:10.987Z"),
    "2026-04-01 08:09:10 UTC",
  );
});

test("readAppBuildMetadata falls back cleanly without injected build constants", () => {
  assert.deepEqual(readAppBuildMetadata(), {
    version: "dev",
    publishedAtDisplay: "--",
  });
});
