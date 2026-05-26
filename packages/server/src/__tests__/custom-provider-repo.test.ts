import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CustomProviderRepo } from "../storage/repositories/custom-provider-repo.js";

describe("CustomProviderRepo", () => {
  let tempDir: string;
  let repo: CustomProviderRepo;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "custom-provider-repo-"));
    repo = new CustomProviderRepo({
      filePath: join(tempDir, "custom-providers.json"),
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists and reloads custom provider configs", () => {
    repo.set({
      id: "review-bot",
      displayName: "Review Bot",
      command: "review-bot",
      args: ["--stdio"],
      env: { REVIEW_MODE: "strict" },
      cwdMode: "workspace_root",
      sessionMode: "interactive",
      startupPrompt: "Review the diff before answering.",
      capabilities: [
        { key: "interactive_session", supported: true, label: "Interactive session" },
        { key: "review", supported: true, label: "Review" },
      ],
      createdAt: 100,
      updatedAt: 100,
    });

    expect(repo.get("review-bot")).toEqual({
      id: "review-bot",
      displayName: "Review Bot",
      command: "review-bot",
      args: ["--stdio"],
      env: { REVIEW_MODE: "strict" },
      cwdMode: "workspace_root",
      sessionMode: "interactive",
      startupPrompt: "Review the diff before answering.",
      capabilities: [
        { key: "interactive_session", supported: true, label: "Interactive session" },
        { key: "review", supported: true, label: "Review" },
      ],
      createdAt: 100,
      updatedAt: 100,
    });
  });

  it("lists providers in updated order and preserves createdAt on overwrite", () => {
    repo.set({
      id: "alpha",
      displayName: "Alpha",
      command: "alpha",
      args: [],
      env: {},
      cwdMode: "workspace_root",
      sessionMode: "interactive",
      capabilities: [{ key: "interactive_session", supported: true, label: "Interactive session" }],
      createdAt: 10,
      updatedAt: 10,
    });
    repo.set({
      id: "beta",
      displayName: "Beta",
      command: "beta",
      args: [],
      env: {},
      cwdMode: "workspace_root",
      sessionMode: "interactive",
      capabilities: [{ key: "interactive_session", supported: true, label: "Interactive session" }],
      createdAt: 20,
      updatedAt: 20,
    });

    repo.set({
      id: "alpha",
      displayName: "Alpha 2",
      command: "alpha2",
      args: ["--fast"],
      env: { MODE: "2" },
      cwdMode: "workspace_root",
      sessionMode: "interactive",
      capabilities: [{ key: "interactive_session", supported: true, label: "Interactive session" }],
      createdAt: 999,
      updatedAt: 30,
    });

    expect(repo.list()).toEqual([
      {
        id: "alpha",
        displayName: "Alpha 2",
        command: "alpha2",
        args: ["--fast"],
        env: { MODE: "2" },
        cwdMode: "workspace_root",
        sessionMode: "interactive",
        capabilities: [
          { key: "interactive_session", supported: true, label: "Interactive session" },
        ],
        createdAt: 10,
        updatedAt: 30,
      },
      {
        id: "beta",
        displayName: "Beta",
        command: "beta",
        args: [],
        env: {},
        cwdMode: "workspace_root",
        sessionMode: "interactive",
        capabilities: [
          { key: "interactive_session", supported: true, label: "Interactive session" },
        ],
        createdAt: 20,
        updatedAt: 20,
      },
    ]);
  });

  it("deletes a custom provider without affecting others", () => {
    repo.set({
      id: "keep",
      displayName: "Keep",
      command: "keep",
      args: [],
      env: {},
      cwdMode: "workspace_root",
      sessionMode: "interactive",
      capabilities: [{ key: "interactive_session", supported: true, label: "Interactive session" }],
      createdAt: 1,
      updatedAt: 1,
    });
    repo.set({
      id: "drop",
      displayName: "Drop",
      command: "drop",
      args: [],
      env: {},
      cwdMode: "workspace_root",
      sessionMode: "interactive",
      capabilities: [{ key: "interactive_session", supported: true, label: "Interactive session" }],
      createdAt: 2,
      updatedAt: 2,
    });

    repo.delete("drop");

    expect(repo.get("drop")).toBeUndefined();
    expect(repo.list().map((provider) => provider.id)).toEqual(["keep"]);
  });
});
