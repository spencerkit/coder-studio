import { describe, expect, it } from "vitest";
import {
  createWslLinuxNativeProcessEnv,
  normalizeWslRuntimeProcessPath,
} from "./wsl-runtime-path.js";

describe("normalizeWslRuntimeProcessPath", () => {
  it("prepends Linux user bin directories ahead of Windows-mounted PATH entries", () => {
    const env = {
      HOME: "/home/w",
      PATH: [
        "/usr/bin",
        "/mnt/c/Users/me/AppData/Local/fnm_multishells/123/claude",
        "/home/w/.local/bin",
      ].join(":"),
    };

    const nextPath = normalizeWslRuntimeProcessPath(env);

    expect(nextPath?.startsWith("/home/w/.local/bin:")).toBe(true);
    expect(nextPath).toContain("/usr/bin");
    expect(nextPath).toContain("/mnt/c/Users/me/AppData/Local/fnm_multishells/123/claude");
    expect(nextPath?.indexOf("/home/w/.local/bin")).toBeLessThan(
      nextPath?.indexOf("/mnt/c/Users/me/AppData/Local/fnm_multishells/123/claude") ?? -1
    );
  });

  it("deduplicates repeated entries while preserving order", () => {
    const env = {
      HOME: "/home/w",
      PATH: "/usr/bin:/usr/bin:/home/w/.local/bin",
    };

    expect(normalizeWslRuntimeProcessPath(env)).toBe(
      "/home/w/.local/bin:/home/w/.local/share/fnm/aliases/default/bin:/home/w/.fnm/aliases/default/bin:/home/w/.volta/bin:/home/w/.asdf/shims:/home/w/.nvm/versions/node/current/bin:/usr/bin"
    );
  });

  it("drops Windows-mounted PATH entries for Linux-native agent spawns", () => {
    const env = createWslLinuxNativeProcessEnv({
      HOME: "/home/w",
      PATH: [
        "/usr/bin",
        "/mnt/c/Users/me/AppData/Local/fnm_multishells/123",
        "/home/w/.local/bin",
      ].join(":"),
      TERM: "xterm-256color",
    });

    expect(env.PATH?.startsWith("/home/w/.local/bin:")).toBe(true);
    expect(env.PATH).not.toContain("/mnt/");
    expect(env.TERM).toBe("xterm-256color");
  });
});
