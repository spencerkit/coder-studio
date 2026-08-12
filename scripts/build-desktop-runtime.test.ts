import { generateKeyPairSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyRuntimeManifestSignature } from "../packages/desktop/src/runtime-manifest.js";
import { buildDesktopShell, DESKTOP_DIST_DIR, resolveDesktopRuntimeUrls } from "./build-desktop.js";
import {
  buildDesktopRuntime,
  createDesktopRuntimeBuildOptions,
  DESKTOP_FACTORY_RUNTIME_DIR,
} from "./build-desktop-runtime.js";
import { CLI_DIR, DESKTOP_DIR } from "./shared/paths.js";

const originalSigningKey = process.env.CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY;
const originalPublicKey = process.env.CODER_STUDIO_RUNTIME_PUBLIC_KEY;
const originalPublishedAt = process.env.CODER_STUDIO_RELEASE_PUBLISHED_AT;
const originalRuntimeUpdateUrl = process.env.CODER_STUDIO_RUNTIME_UPDATE_URL;
const originalFactoryReleaseBaseUrl = process.env.CODER_STUDIO_FACTORY_RELEASE_BASE_URL;

afterEach(() => {
  for (const [key, value] of [
    ["CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY", originalSigningKey],
    ["CODER_STUDIO_RUNTIME_PUBLIC_KEY", originalPublicKey],
    ["CODER_STUDIO_RELEASE_PUBLISHED_AT", originalPublishedAt],
    ["CODER_STUDIO_RUNTIME_UPDATE_URL", originalRuntimeUpdateUrl],
    ["CODER_STUDIO_FACTORY_RELEASE_BASE_URL", originalFactoryReleaseBaseUrl],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("build-desktop-runtime", () => {
  it.each([
    {},
    { CODER_STUDIO_RUNTIME_UPDATE_URL: "", CODER_STUDIO_FACTORY_RELEASE_BASE_URL: "" },
  ])("uses release defaults when Desktop Runtime URL variables are absent or empty", (env) => {
    expect(resolveDesktopRuntimeUrls(env, "win32", "x64")).toEqual({
      runtimeUpdateUrl:
        "https://github.com/spencerkit/coder-studio/releases/latest/download/coder-studio-runtime-win32-x64.manifest.json",
      factoryReleaseBaseUrl: "https://github.com/spencerkit/coder-studio/releases/latest/download/",
    });
  });

  it("emits the Server and Agent automation entry as production ESM bundles", () => {
    const options = createDesktopRuntimeBuildOptions();

    expect(options.entryPoints).toEqual({
      server: resolve(DESKTOP_DIR, "src/sidecar.ts"),
      "automation-entry": resolve(CLI_DIR, "src/automation-entry.ts"),
    });
    expect(options.outdir).toBe(DESKTOP_FACTORY_RUNTIME_DIR);
    expect(options.outExtension).toEqual({ ".js": ".mjs" });
    expect(options.sourcemap).toBe(false);
  });

  it("signs one authoritative release timestamp into schema v2", async () => {
    const keys = generateKeyPairSync("ed25519");
    process.env.CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY = keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    process.env.CODER_STUDIO_RUNTIME_PUBLIC_KEY = keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();
    process.env.CODER_STUDIO_RELEASE_PUBLISHED_AT = "2026-08-08T01:02:03.000Z";

    const { manifest } = await buildDesktopRuntime({
      includeWeb: false,
      packagePrefix: "coder-studio-test-runtime",
    });

    expect(manifest).toMatchObject({
      schemaVersion: 2,
      publishedAt: "2026-08-08T01:02:03.000Z",
    });
    expect(
      verifyRuntimeManifestSignature(manifest, process.env.CODER_STUDIO_RUNTIME_PUBLIC_KEY)
    ).toBe(true);
    expect(
      verifyRuntimeManifestSignature(
        { ...manifest, publishedAt: "2026-08-09T01:02:03.000Z" },
        process.env.CODER_STUDIO_RUNTIME_PUBLIC_KEY
      )
    ).toBe(false);
  }, 60_000);

  it("rejects signed Runtime builds without a release timestamp", async () => {
    const keys = generateKeyPairSync("ed25519");
    process.env.CODER_STUDIO_RUNTIME_SIGNING_PRIVATE_KEY = keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString();
    delete process.env.CODER_STUDIO_RELEASE_PUBLISHED_AT;

    await expect(
      buildDesktopRuntime({ includeWeb: false, packagePrefix: "coder-studio-test-runtime" })
    ).rejects.toThrow("CODER_STUDIO_RELEASE_PUBLISHED_AT");
  }, 60_000);

  it("writes packaged Shell build info with the shared release timestamp", async () => {
    process.env.CODER_STUDIO_RELEASE_PUBLISHED_AT = "2026-08-08T01:02:03.000Z";
    process.env.CODER_STUDIO_RUNTIME_UPDATE_URL = "";
    process.env.CODER_STUDIO_FACTORY_RELEASE_BASE_URL = "";
    const desktopPackage = JSON.parse(
      await readFile(resolve(DESKTOP_DIR, "package.json"), "utf8")
    ) as { version: string };

    await buildDesktopShell({ clean: true });

    await expect(
      readFile(resolve(DESKTOP_DIST_DIR, "build-info.json"), "utf8").then(JSON.parse)
    ).resolves.toMatchObject({
      schemaVersion: 1,
      shellVersion: desktopPackage.version,
      publishedAt: "2026-08-08T01:02:03.000Z",
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
    });
    const bundledMain = await readFile(resolve(DESKTOP_DIST_DIR, "main.cjs"), "utf8");
    expect(bundledMain).toContain(
      "https://github.com/spencerkit/coder-studio/releases/latest/download/"
    );
  }, 60_000);
});
