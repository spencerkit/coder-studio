import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWslEnvironmentTarget,
  EnvironmentStateStore,
  NATIVE_ENVIRONMENT,
} from "./environment-state.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createStore(): Promise<EnvironmentStateStore> {
  const root = await mkdtemp(resolve(tmpdir(), "coder-studio-environment-state-test-"));
  roots.push(root);
  return new EnvironmentStateStore(root);
}

describe("EnvironmentStateStore", () => {
  it("defaults to the Windows native environment", async () => {
    const store = await createStore();
    await expect(store.getStartupTarget()).resolves.toEqual(NATIVE_ENVIRONMENT);
  });

  it("uses a pending WSL target for relaunch and commits it after a successful launch", async () => {
    const store = await createStore();
    const target = createWslEnvironmentTarget("Ubuntu-24.04");

    await store.beginSwitch(target);
    await expect(store.getStartupTarget()).resolves.toEqual(target);

    await store.markLaunchSuccessful(target);
    await expect(store.read()).resolves.toMatchObject({
      selected: target,
      lastKnownGood: target,
    });
    expect("pending" in (await store.read())).toBe(false);
  });

  it("creates stable opaque ids for WSL distribution names", () => {
    expect(createWslEnvironmentTarget(" Ubuntu-24.04 ")).toEqual(
      createWslEnvironmentTarget("Ubuntu-24.04")
    );
  });
});
