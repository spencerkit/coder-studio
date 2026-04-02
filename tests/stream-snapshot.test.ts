import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeMonotonicTextSnapshot,
  planTerminalSnapshotUpdate,
} from "../apps/web/src/shared/utils/stream-snapshot";

test("mergeMonotonicTextSnapshot keeps the richer local snapshot when replay is shorter", () => {
  assert.equal(
    mergeMonotonicTextSnapshot("abcdef", "abc", 32),
    "abcdef",
  );
});

test("mergeMonotonicTextSnapshot stitches a truncated-head replay with new tail output", () => {
  assert.equal(
    mergeMonotonicTextSnapshot("abcdef", "cdefgh", 32),
    "abcdefgh",
  );
});

test("planTerminalSnapshotUpdate appends new tail output without resetting on head truncation", () => {
  assert.deepEqual(
    planTerminalSnapshotUpdate("abcdef", "cdefgh"),
    { kind: "append", data: "gh" },
  );
});

test("planTerminalSnapshotUpdate ignores a shorter replay already contained in the terminal buffer", () => {
  assert.deepEqual(
    planTerminalSnapshotUpdate("abcdef", "cdef"),
    { kind: "noop" },
  );
});

test("planTerminalSnapshotUpdate replaces genuinely divergent snapshots", () => {
  assert.deepEqual(
    planTerminalSnapshotUpdate("abcdef", "xyz"),
    { kind: "replace", data: "xyz" },
  );
});
