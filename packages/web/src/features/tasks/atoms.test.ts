import type { TaskDefinition, TaskRun } from "@coder-studio/core";
import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { latestVerifyRunAtomFamily, taskStateAtomFamily } from "./atoms";

const verifyTask: TaskDefinition = {
  id: "ci:verify",
  workspaceId: "ws-test",
  kind: "verify",
  label: "ci:verify",
  command: "pnpm",
  args: ["ci:verify"],
  displayCommand: "pnpm ci:verify",
  cwdPath: ".",
  source: "package-json",
  priority: 900,
};

const verifyRun: TaskRun = {
  id: "run-verify",
  workspaceId: "ws-test",
  taskId: "ci:verify",
  terminalId: "term-verify",
  status: "failed",
  command: "pnpm",
  args: ["ci:verify"],
  cwdPath: ".",
  startedAt: 100,
  finishedAt: 200,
};

describe("task atoms", () => {
  it("finds the latest verify run from the discovered verify task id", () => {
    const store = createStore();

    store.set(taskStateAtomFamily("ws-test"), {
      tasks: [verifyTask],
      runs: [verifyRun],
      loading: false,
    });

    expect(store.get(latestVerifyRunAtomFamily("ws-test"))).toBe(verifyRun);
  });
});
