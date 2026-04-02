import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBuildPublishedAt,
  readAppBuildMetadata,
} from "../apps/web/src/shared/app/build-metadata";

test("formatBuildPublishedAt renders a stable local timestamp", () => {
  const localValue = new Date("2026-04-01T08:09:10.987Z");
  const offsetMinutes = -localValue.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const offsetHours = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const offsetRemainderMinutes = String(absoluteMinutes % 60).padStart(2, "0");

  assert.equal(
    formatBuildPublishedAt("2026-04-01T08:09:10.987Z"),
    `${localValue.getFullYear()}-${String(localValue.getMonth() + 1).padStart(2, "0")}-${String(localValue.getDate()).padStart(2, "0")} ${String(localValue.getHours()).padStart(2, "0")}:${String(localValue.getMinutes()).padStart(2, "0")}:${String(localValue.getSeconds()).padStart(2, "0")} UTC${sign}${offsetHours}:${offsetRemainderMinutes}`,
  );
});

test("readAppBuildMetadata falls back cleanly without injected build constants", () => {
  assert.deepEqual(readAppBuildMetadata(), {
    version: "dev",
    publishedAtDisplay: "--",
  });
});
