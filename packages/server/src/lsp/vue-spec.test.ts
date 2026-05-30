import { describe, expect, it } from "vitest";
import {
  buildVueSpecParts,
  inferVueLanguageServerLocation,
  parseVueBridgeMode,
} from "./vue-spec.js";

describe("inferVueLanguageServerLocation", () => {
  it("derives the install root for a POSIX shim", () => {
    const location = inferVueLanguageServerLocation(
      "/tmp/.coder-studio/lsp-tools/vue/3.3.2/node_modules/.bin/vue-language-server"
    );
    // Use path.sep-tolerant assertion: regardless of host, the trailing two
    // segments should be @vue / language-server.
    expect(location?.replace(/\\/g, "/")).toBe(
      "/tmp/.coder-studio/lsp-tools/vue/3.3.2/node_modules/@vue/language-server"
    );
  });

  it("derives the install root for a Windows cmd shim", () => {
    const location = inferVueLanguageServerLocation(
      "C:\\state\\lsp-tools\\vue\\3.3.2\\node_modules\\.bin\\vue-language-server.cmd"
    );
    expect(location?.replace(/\\/g, "/")).toBe(
      "C:/state/lsp-tools/vue/3.3.2/node_modules/@vue/language-server"
    );
  });

  it("returns null when the executable is not under node_modules/.bin", () => {
    expect(inferVueLanguageServerLocation("vue-language-server")).toBeNull();
    expect(inferVueLanguageServerLocation("/opt/vue-language-server")).toBeNull();
  });
});

describe("buildVueSpecParts", () => {
  it("wires Volar's initializationOptions.tsdk to the typescript sibling of the plugin", () => {
    const parts = buildVueSpecParts({
      vueCommand: "vue-language-server",
      vueArgs: ["--stdio"],
      vueLanguageServerLocation: "/install/node_modules/@vue/language-server",
      typescriptCommand: "/bundled/node",
      typescriptArgs: ["/bundled/lib/cli.mjs", "--stdio"],
    });

    expect(parts.initializationOptions).toEqual({
      typescript: { tsdk: expect.stringMatching(/node_modules.typescript.lib$/) },
    });
  });

  it("returns a tsserver/request bridge companion with the vue typescript plugin", () => {
    const parts = buildVueSpecParts({
      vueCommand: "vue-language-server",
      vueArgs: ["--stdio"],
      vueLanguageServerLocation: "/install/node_modules/@vue/language-server",
      typescriptCommand: "node",
      typescriptArgs: ["/bundled/lib/cli.mjs", "--stdio"],
    });

    expect(parts.bridges).toEqual({ tsserverRequest: true });
    expect(parts.companion).toMatchObject({
      command: "node",
      args: ["/bundled/lib/cli.mjs", "--stdio"],
      initializationOptions: {
        plugins: [
          {
            name: "@vue/typescript-plugin",
            location: "/install/node_modules/@vue/language-server",
            languages: ["vue"],
          },
        ],
      },
    });
  });

  it("omits the companion when bridge mode is off so volar runs alone", () => {
    const parts = buildVueSpecParts({
      vueCommand: "vue-language-server",
      vueArgs: ["--stdio"],
      vueLanguageServerLocation: "/install/node_modules/@vue/language-server",
      typescriptCommand: "node",
      typescriptArgs: ["/bundled/lib/cli.mjs", "--stdio"],
      bridgeMode: "off",
    });

    expect(parts.bridges).toBeUndefined();
    expect(parts.companion).toBeUndefined();
  });
});

describe("parseVueBridgeMode", () => {
  it("defaults to auto", () => {
    expect(parseVueBridgeMode(undefined)).toBe("auto");
    expect(parseVueBridgeMode("")).toBe("auto");
    expect(parseVueBridgeMode("on")).toBe("auto");
    expect(parseVueBridgeMode("AUTO")).toBe("auto");
  });

  it("treats 'off' as the only way to disable the bridge", () => {
    expect(parseVueBridgeMode("off")).toBe("off");
    expect(parseVueBridgeMode("OFF")).toBe("off");
  });
});
