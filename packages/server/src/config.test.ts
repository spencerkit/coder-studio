import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseServerConfig } from "./config.js";

function readCliPackageVersion(): string | undefined {
  return (
    JSON.parse(readFileSync(new URL("../../cli/package.json", import.meta.url), "utf-8")) as {
      version?: string;
    }
  ).version;
}

describe("parseServerConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to port 4173 when PORT is not set", () => {
    delete process.env.PORT;

    const config = parseServerConfig();

    expect(config.port).toBe(4173);
  });

  it("prefers explicit overrides over environment defaults", () => {
    process.env.PORT = "4173";

    const config = parseServerConfig({ port: 8080 });

    expect(config.port).toBe(8080);
  });

  it("defaults appVersion to the CLI package version", () => {
    delete process.env.CODER_STUDIO_APP_VERSION;

    const config = parseServerConfig();

    expect(config.appVersion).toBe(readCliPackageVersion());
  });

  it("can resolve the CLI package version when imported via native ESM", () => {
    const env = { ...process.env };
    delete env.CODER_STUDIO_APP_VERSION;

    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import('./src/config.ts').then((module) => { process.stdout.write(String(module.parseServerConfig().appVersion)); });",
      ],
      {
        cwd: new URL("../", import.meta.url),
        env,
        encoding: "utf-8",
      }
    );

    expect(output).toBe(readCliPackageVersion());
  });

  it("prefers explicit appVersion override over inferred CLI version", () => {
    const config = parseServerConfig({ appVersion: "9.9.9" });

    expect(config.appVersion).toBe("9.9.9");
  });

  it("provides unsupported update runtime defaults", () => {
    const config = parseServerConfig();

    expect(config.update).toEqual({
      supported: false,
      installKind: "unsupported",
      packageName: "@spencer-kit/coder-studio",
      cliCommand: "coder-studio",
      workerEntryPath: undefined,
      npmCommand: "npm",
      restartArgs: ["serve", "--restart"],
      installArgsPrefix: ["install", "-g"],
      unsupportedReason: "In-app update is only supported for global npm installs",
    });
  });

  it("uses the temp state directory by default outside production", () => {
    delete process.env.NODE_ENV;
    delete process.env.DATA_DIR;
    delete process.env.STATE_DIR;

    const config = parseServerConfig();

    expect((config as { stateDir?: string }).stateDir).toBe(join(tmpdir(), "coder-studio-dev"));
  });

  it("uses a stable user state directory by default in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DATA_DIR;
    delete process.env.STATE_DIR;

    const config = parseServerConfig();

    expect((config as { stateDir?: string }).stateDir).toBe(
      join(homedir(), ".coder-studio", "data")
    );
  });

  it("prefers STATE_DIR over legacy DATA_DIR", () => {
    process.env.STATE_DIR = "/tmp/state-root";
    process.env.DATA_DIR = "/tmp/legacy-state/legacy-state.sqlite";

    const config = parseServerConfig();

    expect((config as { stateDir?: string }).stateDir).toBe("/tmp/state-root");
  });

  it("preserves an explicit STATE_DIR that ends with .db", () => {
    process.env.STATE_DIR = "/tmp/state-root.db";
    process.env.DATA_DIR = "/tmp/legacy-state/legacy-state.sqlite";

    const config = parseServerConfig();

    expect((config as { stateDir?: string }).stateDir).toBe("/tmp/state-root.db");
  });

  it("preserves an explicit in-memory STATE_DIR", () => {
    process.env.STATE_DIR = ":memory:";
    delete process.env.DATA_DIR;

    const config = parseServerConfig();

    expect((config as { stateDir?: string }).stateDir).toBe(":memory:");
  });

  it("normalizes legacy DATA_DIR file paths to the parent state directory", () => {
    delete process.env.STATE_DIR;
    process.env.DATA_DIR = "/tmp/legacy-state/legacy-state.sqlite";

    const config = parseServerConfig();

    expect((config as { stateDir?: string }).stateDir).toBe("/tmp/legacy-state");
  });

  it("normalizes legacy dataDir overrides to the parent state directory", () => {
    const config = parseServerConfig({ dataDir: "/tmp/legacy-override/custom.sqlite" });

    expect((config as { stateDir?: string }).stateDir).toBe("/tmp/legacy-override");
  });

  it("preserves explicit stateDir overrides that end with .db", () => {
    const config = parseServerConfig({ stateDir: "/tmp/modern-state/custom-dir.db" });

    expect((config as { stateDir?: string }).stateDir).toBe("/tmp/modern-state/custom-dir.db");
  });

  it("uses tmpdir/coder-studio-dev/uploads in development", () => {
    process.env.NODE_ENV = "development";
    delete process.env.UPLOADS_DIR;

    const config = parseServerConfig();

    expect(config.uploadsDir).toBe(join(tmpdir(), "coder-studio-dev", "uploads"));
  });

  it("uses a stable temp uploads dir in test mode", () => {
    process.env.NODE_ENV = "test";
    delete process.env.UPLOADS_DIR;

    const a = parseServerConfig();
    const b = parseServerConfig();

    expect(a.uploadsDir).toBe(b.uploadsDir);
    expect(a.uploadsDir).toContain("coder-studio-test-uploads-");
  });

  it("uses ~/.coder-studio/uploads in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.UPLOADS_DIR;

    const config = parseServerConfig();

    expect(config.uploadsDir).toBe(join(homedir(), ".coder-studio", "uploads"));
  });

  it("honours UPLOADS_DIR env var", () => {
    process.env.UPLOADS_DIR = "/custom/uploads";

    const config = parseServerConfig();

    expect(config.uploadsDir).toBe("/custom/uploads");
  });

  it("honours overrides.uploadsDir", () => {
    const config = parseServerConfig({ uploadsDir: "/explicit" });

    expect(config.uploadsDir).toBe("/explicit");
  });
});
