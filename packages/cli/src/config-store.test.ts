import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CliConfig,
  getCliConfigPath,
  normalizeLegacyDataDir,
  readCliConfig,
  writeCliConfig,
} from "./config-store.js";

describe("config-store", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  const originalCoderStudioHome = process.env.CODER_STUDIO_HOME;
  let testHomeDir: string;

  beforeEach(() => {
    testHomeDir = mkdtempSync(join(tmpdir(), "cs-cli-config-home-"));
    process.env.HOME = testHomeDir;
    process.env.USERPROFILE = testHomeDir;
    delete process.env.CODER_STUDIO_HOME;
  });

  afterEach(() => {
    if (existsSync(testHomeDir)) {
      rmSync(testHomeDir, { recursive: true, force: true });
    }

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }

    if (originalCoderStudioHome === undefined) {
      delete process.env.CODER_STUDIO_HOME;
    } else {
      process.env.CODER_STUDIO_HOME = originalCoderStudioHome;
    }
  });

  it("returns null when config file does not exist", () => {
    expect(readCliConfig()).toBeNull();
  });

  it("writes and reads host port state-dir and password config", () => {
    const config = {
      host: "0.0.0.0",
      port: 4186,
      stateDir: "/tmp/cs-data",
      password: "sekrit",
    };

    writeCliConfig(config as CliConfig);

    expect(readCliConfig()).toEqual(config);
  });

  it("isolates config under an explicit Coder Studio home without replacing HOME", () => {
    const isolatedHome = join(testHomeDir, "acceptance-home");
    process.env.CODER_STUDIO_HOME = isolatedHome;

    writeCliConfig({ host: "127.0.0.1", port: 43123 });

    expect(getCliConfigPath()).toBe(join(isolatedHome, "config.json"));
    expect(readCliConfig()).toEqual({ host: "127.0.0.1", port: 43123 });
    expect(existsSync(join(testHomeDir, ".coder-studio", "config.json"))).toBe(false);
  });

  it("keeps a directory input as the state directory", () => {
    expect(normalizeLegacyDataDir("/tmp/cs-data")).toBe("/tmp/cs-data");
  });

  it("normalizes a legacy sqlite file path to its parent state directory", () => {
    expect(normalizeLegacyDataDir("/tmp/cs-data/custom.sqlite")).toBe("/tmp/cs-data");
  });

  it("preserves a saved stateDir that ends with .db", () => {
    writeCliConfig({
      stateDir: "/tmp/modern-state/custom-dir.db",
    } as CliConfig);

    expect(readCliConfig()).toEqual({
      stateDir: "/tmp/modern-state/custom-dir.db",
    });
  });

  it("preserves an in-memory saved stateDir", () => {
    writeCliConfig({
      stateDir: ":memory:",
    } as CliConfig);

    expect(readCliConfig()).toEqual({
      stateDir: ":memory:",
    });
  });

  it("reads legacy dataDir config as stateDir", () => {
    writeCliConfig({
      host: "127.0.0.1",
      port: 4186,
      stateDir: "/tmp/modern-state",
      password: "sekrit",
    } as CliConfig);

    const configPath = getCliConfigPath();
    const stored = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    stored.dataDir = "/tmp/legacy-state/legacy-state.sqlite";
    delete stored.stateDir;

    writeFileSync(configPath, JSON.stringify(stored, null, 2), "utf-8");

    expect(readCliConfig()).toEqual({
      host: "127.0.0.1",
      port: 4186,
      stateDir: "/tmp/legacy-state",
      password: "sekrit",
    });
  });

  it("does not persist ephemeral port zero in config", () => {
    writeCliConfig({
      host: "127.0.0.1",
      port: 0,
      stateDir: "/tmp/cs-data",
      password: "sekrit",
    } as CliConfig);

    expect(JSON.parse(readFileSync(getCliConfigPath(), "utf-8"))).toEqual({
      host: "127.0.0.1",
      stateDir: "/tmp/cs-data",
      password: "sekrit",
    });
    expect(readCliConfig()).toEqual({
      host: "127.0.0.1",
      stateDir: "/tmp/cs-data",
      password: "sekrit",
    });
  });
});
