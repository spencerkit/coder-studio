import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CustomProviderRepo } from "../storage/repositories/custom-provider-repo.js";

describe("CustomProviderRepo", () => {
  let tempDir: string;
  let filePath: string;
  let repo: CustomProviderRepo;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "custom-provider-repo-"));
    filePath = join(tempDir, "custom-providers.json");
    repo = new CustomProviderRepo({
      filePath,
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rehydrates a provider from disk in a fresh repo instance", () => {
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

    const reloadedRepo = new CustomProviderRepo({ filePath });

    expect(reloadedRepo.get("review-bot")).toEqual({
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

  it("lists rehydrated providers by updated order and preserves createdAt on overwrite", () => {
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

    const reloadedRepo = new CustomProviderRepo({ filePath });

    expect(reloadedRepo.list()).toEqual([
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

  it("persists deletions so a fresh repo instance keeps only remaining providers", () => {
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

    const reloadedRepo = new CustomProviderRepo({ filePath });

    expect(reloadedRepo.get("drop")).toBeUndefined();
    expect(reloadedRepo.list().map((provider) => provider.id)).toEqual(["keep"]);
  });
});
