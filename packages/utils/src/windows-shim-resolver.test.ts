import { describe, expect, it, vi } from "vitest";
import { parseCmdShim, resolveSpawnArgv } from "./windows-shim-resolver.js";

const STANDARD_NPM_CMD_SHIM = String.raw`@SETLOCAL
@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\..\@openai\codex\bin\codex.js" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\..\@openai\codex\bin\codex.js" %*
)
`;

const NPM_CMD_SHIM_VARIANT = String.raw`@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
`;

const UNRECOGNIZED_CMD_SHIM = String.raw`@echo off
echo this shim is not standard
exit /b 1
`;

interface MockFsOptions {
  files: Record<string, string>;
}

function createMockFs({ files }: MockFsOptions) {
  const normalize = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  const map = new Map<string, string>(Object.entries(files).map(([k, v]) => [normalize(k), v]));

  return {
    readFileSync: vi.fn((p: string) => {
      const value = map.get(normalize(p));
      if (value === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file ${p}`), { code: "ENOENT" });
      }
      return value;
    }),
    existsSync: vi.fn((p: string) => map.has(normalize(p))),
  };
}

describe("resolveSpawnArgv", () => {
  it("returns argv unchanged on linux", () => {
    const argv = ["codex", "--model", "gpt-4"];
    const out = resolveSpawnArgv(argv, { platform: "linux" });
    expect(out).toEqual(argv);
    expect(out).not.toBe(argv);
  });

  it("returns argv unchanged on darwin", () => {
    const argv = ["codex", "--model", "gpt-4"];
    const out = resolveSpawnArgv(argv, { platform: "darwin" });
    expect(out).toEqual(argv);
  });

  it("returns argv unchanged when argv is empty", () => {
    expect(resolveSpawnArgv([], { platform: "win32" })).toEqual([]);
  });

  it("returns argv unchanged when command is not found in PATH", () => {
    const fs = createMockFs({ files: {} });
    const out = resolveSpawnArgv(["codex"], {
      platform: "win32",
      pathEnv: "C:\\bin",
      pathExt: ".COM;.EXE;.CMD",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    expect(out).toEqual(["codex"]);
  });

  it("returns absolute path when command resolves to a real .exe", () => {
    const fs = createMockFs({
      files: { "C:\\bin\\git.exe": "" },
    });
    const out = resolveSpawnArgv(["git", "status"], {
      platform: "win32",
      pathEnv: "C:\\bin",
      pathExt: ".COM;.EXE;.CMD",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    expect(out).toEqual(["C:\\bin\\git.exe", "status"]);
  });

  it("parses an npm-style .cmd shim and spawns node + entry directly", () => {
    const shimPath = "C:\\Users\\u\\AppData\\Local\\fnm\\codex.cmd";
    const fs = createMockFs({
      files: { [shimPath]: STANDARD_NPM_CMD_SHIM },
    });
    const out = resolveSpawnArgv(["codex", "--model", "gpt-4"], {
      platform: "win32",
      pathEnv: "C:\\Users\\u\\AppData\\Local\\fnm",
      pathExt: ".COM;.EXE;.CMD",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    expect(out[0].toLowerCase()).toBe("c:\\users\\u\\appdata\\local\\fnm\\node.exe".toLowerCase());
    expect(out[1].toLowerCase()).toBe(
      "c:\\users\\u\\appdata\\local\\@openai\\codex\\bin\\codex.js".toLowerCase()
    );
    expect(out.slice(2)).toEqual(["--model", "gpt-4"]);
  });

  it("parses the SETLOCAL/find_dp0 variant of cmd-shim", () => {
    const shimPath = "C:\\bin\\codex.cmd";
    const fs = createMockFs({
      files: { [shimPath]: NPM_CMD_SHIM_VARIANT },
    });
    const out = resolveSpawnArgv(["codex"], {
      platform: "win32",
      pathEnv: "C:\\bin",
      pathExt: ".COM;.EXE;.CMD",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    expect(out[0].toLowerCase()).toBe("c:\\bin\\node.exe".toLowerCase());
    expect(out[1].toLowerCase()).toBe(
      "c:\\bin\\node_modules\\@openai\\codex\\bin\\codex.js".toLowerCase()
    );
  });

  it("falls back to cmd.exe wrapper when .cmd shim cannot be parsed", () => {
    const shimPath = "C:\\bin\\weird.cmd";
    const fs = createMockFs({
      files: { [shimPath]: UNRECOGNIZED_CMD_SHIM },
    });
    const out = resolveSpawnArgv(["weird", "arg1"], {
      platform: "win32",
      pathEnv: "C:\\bin",
      pathExt: ".COM;.EXE;.CMD",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    expect(out).toEqual(["cmd.exe", "/d", "/s", "/c", shimPath, "arg1"]);
  });

  it("respects PATHEXT order — picks .EXE before .CMD when both exist", () => {
    const fs = createMockFs({
      files: {
        "C:\\bin\\foo.cmd": STANDARD_NPM_CMD_SHIM,
        "C:\\bin\\foo.exe": "",
      },
    });
    const out = resolveSpawnArgv(["foo"], {
      platform: "win32",
      pathEnv: "C:\\bin",
      pathExt: ".COM;.EXE;.CMD",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    expect(out).toEqual(["C:\\bin\\foo.exe"]);
  });

  it("when argv[0] already has an extension, does not loop PATHEXT", () => {
    const fs = createMockFs({
      files: {
        "C:\\bin\\foo.cmd": STANDARD_NPM_CMD_SHIM,
        "C:\\bin\\foo.exe": "",
      },
    });
    const out = resolveSpawnArgv(["foo.cmd"], {
      platform: "win32",
      pathEnv: "C:\\bin",
      pathExt: ".COM;.EXE;.CMD",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    // Should resolve via .cmd parse, not .exe
    expect(out[0].toLowerCase()).toBe("c:\\bin\\node.exe".toLowerCase());
  });

  it("when argv[0] is already an absolute .exe, returns it as-is", () => {
    const abs = "C:\\Program Files\\Git\\bin\\git.exe";
    const fs = createMockFs({ files: { [abs]: "" } });
    const out = resolveSpawnArgv([abs, "status"], {
      platform: "win32",
      pathEnv: "",
      pathExt: ".EXE",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    expect(out).toEqual([abs, "status"]);
  });

  it("when argv[0] is already an absolute .cmd, parses it directly", () => {
    const abs = "C:\\bin\\codex.cmd";
    const fs = createMockFs({ files: { [abs]: STANDARD_NPM_CMD_SHIM } });
    const out = resolveSpawnArgv([abs], {
      platform: "win32",
      pathEnv: "",
      pathExt: "",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    expect(out[0].toLowerCase()).toBe("c:\\bin\\node.exe".toLowerCase());
    expect(out[1].toLowerCase()).toBe("c:\\@openai\\codex\\bin\\codex.js".toLowerCase());
  });

  it("searches multiple PATH entries in order", () => {
    const fs = createMockFs({
      files: { "D:\\tools\\codex.exe": "" },
    });
    const out = resolveSpawnArgv(["codex"], {
      platform: "win32",
      pathEnv: "C:\\nope;D:\\tools;E:\\also-nope",
      pathExt: ".EXE",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    expect(out).toEqual(["D:\\tools\\codex.exe"]);
  });

  it("ignores empty PATH segments", () => {
    const fs = createMockFs({
      files: { "C:\\bin\\codex.exe": "" },
    });
    const out = resolveSpawnArgv(["codex"], {
      platform: "win32",
      pathEnv: ";;C:\\bin;;",
      pathExt: ".EXE",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    expect(out).toEqual(["C:\\bin\\codex.exe"]);
  });

  it("matches PATHEXT case-insensitively", () => {
    const fs = createMockFs({
      files: { "C:\\bin\\codex.CMD": STANDARD_NPM_CMD_SHIM },
    });
    const out = resolveSpawnArgv(["codex"], {
      platform: "win32",
      pathEnv: "C:\\bin",
      pathExt: ".com;.exe;.cmd",
      readFileSync: fs.readFileSync,
      existsSync: fs.existsSync,
    });
    // Should still parse the shim (the .CMD on disk vs .cmd in PATHEXT)
    expect(out[0].toLowerCase()).toBe("c:\\bin\\node.exe".toLowerCase());
  });
});

describe("parseCmdShim", () => {
  it("extracts node path and js entry from standard npm shim", () => {
    const result = parseCmdShim("C:\\bin\\codex.cmd", STANDARD_NPM_CMD_SHIM);
    expect(result).not.toBeNull();
    expect(result!.node.toLowerCase()).toBe("c:\\bin\\node.exe".toLowerCase());
    expect(result!.entry.toLowerCase()).toBe("c:\\@openai\\codex\\bin\\codex.js".toLowerCase());
  });

  it("extracts from the find_dp0 variant", () => {
    const result = parseCmdShim("C:\\bin\\codex.cmd", NPM_CMD_SHIM_VARIANT);
    expect(result).not.toBeNull();
    expect(result!.node.toLowerCase()).toBe("c:\\bin\\node.exe".toLowerCase());
    expect(result!.entry.toLowerCase()).toBe(
      "c:\\bin\\node_modules\\@openai\\codex\\bin\\codex.js".toLowerCase()
    );
  });

  it("returns null when shim does not contain a recognizable js entry", () => {
    expect(parseCmdShim("C:\\bin\\weird.cmd", UNRECOGNIZED_CMD_SHIM)).toBeNull();
  });

  it("returns null on completely empty input", () => {
    expect(parseCmdShim("C:\\bin\\x.cmd", "")).toBeNull();
  });
});
