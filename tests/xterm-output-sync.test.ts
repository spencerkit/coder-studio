import test from "node:test";
import assert from "node:assert/strict";

import { syncXtermOutputState } from "../apps/web/src/components/terminal/xterm-output-sync";

type FakeTerm = {
  reset: () => void;
  write: (value: string) => void;
};

const createFakeTerm = () => {
  const writes: string[] = [];
  let resets = 0;
  const term: FakeTerm = {
    reset() {
      resets += 1;
    },
    write(value: string) {
      writes.push(value);
    },
  };
  return {
    term,
    writes,
    get resets() {
      return resets;
    },
  };
};

test("syncXtermOutputState replays the first buffered snapshot in incremental mode before live writes exist", () => {
  const fake = createFakeTerm();

  const result = syncXtermOutputState({
    term: fake.term,
    previousIdentity: "term-17",
    nextIdentity: "term-17",
    previousOutput: "",
    nextOutput: "Claude Code",
    outputSyncStrategy: "incremental",
    hasImperativeWrites: false,
  });

  assert.equal(fake.resets, 0);
  assert.deepEqual(fake.writes, ["Claude Code"]);
  assert.deepEqual(result, {
    snapshot: "Claude Code",
    hasImperativeWrites: false,
  });
});

test("syncXtermOutputState does not replay incremental props after imperative writes when the prop snapshot is already caught up", () => {
  const fake = createFakeTerm();

  const result = syncXtermOutputState({
    term: fake.term,
    previousIdentity: "term-17",
    nextIdentity: "term-17",
    previousOutput: "Claude Code prompt",
    nextOutput: "Claude Code prompt",
    outputSyncStrategy: "incremental",
    hasImperativeWrites: true,
  });

  assert.equal(fake.resets, 0);
  assert.deepEqual(fake.writes, []);
  assert.deepEqual(result, {
    snapshot: "Claude Code prompt",
    hasImperativeWrites: true,
  });
});

test("syncXtermOutputState backfills missing incremental output after imperative writes when the prop snapshot moves forward", () => {
  const fake = createFakeTerm();

  const result = syncXtermOutputState({
    term: fake.term,
    previousIdentity: "term-17",
    nextIdentity: "term-17",
    previousOutput: "codex\n",
    nextOutput: "codex\ntrust prompt\n",
    outputSyncStrategy: "incremental",
    hasImperativeWrites: true,
  });

  assert.equal(fake.resets, 0);
  assert.deepEqual(fake.writes, ["trust prompt\n"]);
  assert.deepEqual(result, {
    snapshot: "codex\ntrust prompt\n",
    hasImperativeWrites: true,
  });
});

test("syncXtermOutputState replays the full snapshot when imperative backfill includes cursor-control ansi", () => {
  const fake = createFakeTerm();

  const result = syncXtermOutputState({
    term: fake.term,
    previousIdentity: "term-17",
    nextIdentity: "term-17",
    previousOutput: "$ codex\r\n",
    nextOutput: "$ codex\r\n\u001b[1;1HYou are in /tmp/demo\u001b[3;1H1. Yes, continue",
    outputSyncStrategy: "incremental",
    hasImperativeWrites: true,
  });

  assert.equal(fake.resets, 1);
  assert.deepEqual(fake.writes, ["$ codex\r\n\u001b[1;1HYou are in /tmp/demo\u001b[3;1H1. Yes, continue"]);
  assert.deepEqual(result, {
    snapshot: "$ codex\r\n\u001b[1;1HYou are in /tmp/demo\u001b[3;1H1. Yes, continue",
    hasImperativeWrites: false,
  });
});

test("syncXtermOutputState fully replaces the terminal contents in replace mode", () => {
  const fake = createFakeTerm();

  const result = syncXtermOutputState({
    term: fake.term,
    previousIdentity: "term-17",
    nextIdentity: "term-17",
    previousOutput: "old text",
    nextOutput: "new\ntranscript",
    outputSyncStrategy: "replace",
    hasImperativeWrites: false,
  });

  assert.equal(fake.resets, 1);
  assert.deepEqual(fake.writes, ["new\ntranscript"]);
  assert.deepEqual(result, {
    snapshot: "new\ntranscript",
    hasImperativeWrites: false,
  });
});
