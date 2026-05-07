import { homedir, tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { parseServerConfig } from "./config.js";

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

    expect(config.appVersion).toBe("0.3.0");
  });

  it("prefers explicit appVersion override over inferred CLI version", () => {
    const config = parseServerConfig({ appVersion: "9.9.9" });

    expect(config.appVersion).toBe("9.9.9");
  });

  it("uses the temp sqlite file by default outside production", () => {
    delete process.env.NODE_ENV;
    delete process.env.DATA_DIR;

    const config = parseServerConfig();

    expect(config.dataDir).toBe(join(tmpdir(), "coder-studio-dev.db"));
  });

  it("uses a stable user data sqlite path by default in production", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DATA_DIR;

    const config = parseServerConfig();

    expect(config.dataDir).toBe(join(homedir(), ".coder-studio", "data", "coder-studio.db"));
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
