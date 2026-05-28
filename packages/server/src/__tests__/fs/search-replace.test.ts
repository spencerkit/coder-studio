import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applySearchSession,
  createSearchSession,
  previewSearchSessionFile,
} from "../../fs/search-replace.js";

describe("search replace engine", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `search-replace-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(rootDir, { recursive: true });
    await mkdir(join(rootDir, "src"), { recursive: true });
    await mkdir(join(rootDir, "dist"), { recursive: true });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("builds grouped results with replacement previews for plain search", async () => {
    await writeFile(join(rootDir, "src", "app.ts"), "const query = queryValue;\n");

    const session = await createSearchSession(rootDir, {
      query: "query",
      replace: "replaceQuery",
      isRegex: false,
      matchCase: true,
      matchWholeWord: false,
      preserveCase: false,
      includeGlobs: [],
      excludeGlobs: [],
      useIgnoreFiles: true,
      useExcludeSettings: true,
      onlyOpenEditors: false,
      openEditorPaths: [],
      maxFiles: 50,
      maxMatchesPerFile: 20,
    });

    expect(session.result.files[0]).toMatchObject({
      path: "src/app.ts",
      matchCount: 2,
    });
    expect(session.result.files[0]?.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          preview: "const query = queryValue;",
          replacementPreview: "const replaceQuery = queryValue;",
        }),
      ])
    );
  });

  it("supports regex capture groups and preserve case", async () => {
    await writeFile(join(rootDir, "src", "tokens.txt"), "foo FOO Foo\n");

    const session = await createSearchSession(rootDir, {
      query: "(foo)",
      replace: "bar",
      isRegex: true,
      matchCase: false,
      matchWholeWord: false,
      preserveCase: true,
      includeGlobs: [],
      excludeGlobs: [],
      useIgnoreFiles: true,
      useExcludeSettings: true,
      onlyOpenEditors: false,
      openEditorPaths: [],
      maxFiles: 50,
      maxMatchesPerFile: 20,
    });

    expect(session.result.files[0]?.matches.map((match) => match.replacementPreview)).toEqual([
      "bar FOO Foo",
      "foo BAR Foo",
      "foo FOO Bar",
    ]);
  });

  it("respects include and exclude globs plus open editors filtering", async () => {
    await writeFile(join(rootDir, "src", "keep.ts"), "needle\n");
    await writeFile(join(rootDir, "src", "skip.spec.ts"), "needle\n");
    await writeFile(join(rootDir, "dist", "ignored.ts"), "needle\n");

    const session = await createSearchSession(rootDir, {
      query: "needle",
      replace: "done",
      isRegex: false,
      matchCase: true,
      matchWholeWord: false,
      preserveCase: false,
      includeGlobs: ["src/**/*.ts"],
      excludeGlobs: ["**/*.spec.ts"],
      useIgnoreFiles: true,
      useExcludeSettings: true,
      onlyOpenEditors: true,
      openEditorPaths: ["src/keep.ts", "src/skip.spec.ts"],
      maxFiles: 50,
      maxMatchesPerFile: 20,
    });

    expect(session.result.files.map((file) => file.path)).toEqual(["src/keep.ts"]);
  });

  it("honors standard ignore sources when the ignore/exclude toggle is enabled", async () => {
    await writeFile(join(rootDir, ".ignore"), "ignored-from-ignore.ts\n");
    await writeFile(join(rootDir, ".rgignore"), "ignored-from-rgignore.ts\n");
    await mkdir(join(rootDir, ".git", "info"), { recursive: true });
    await writeFile(join(rootDir, ".git", "info", "exclude"), "ignored-from-git-info.ts\n");
    await writeFile(join(rootDir, "src", "visible.ts"), "needle\n");
    await writeFile(join(rootDir, "ignored-from-ignore.ts"), "needle\n");
    await writeFile(join(rootDir, "ignored-from-rgignore.ts"), "needle\n");
    await writeFile(join(rootDir, "ignored-from-git-info.ts"), "needle\n");

    const session = await createSearchSession(rootDir, {
      query: "needle",
      replace: "done",
      isRegex: false,
      matchCase: true,
      matchWholeWord: false,
      preserveCase: false,
      includeGlobs: [],
      excludeGlobs: [],
      useIgnoreFiles: true,
      useExcludeSettings: true,
      onlyOpenEditors: false,
      openEditorPaths: [],
      maxFiles: 50,
      maxMatchesPerFile: 20,
    });

    expect(session.result.files.map((file) => file.path)).toEqual(["src/visible.ts"]);
  });

  it("builds preview payloads from the same replacement engine", async () => {
    await writeFile(join(rootDir, "src", "app.ts"), "const query = queryValue;\n");

    const session = await createSearchSession(rootDir, {
      query: "query",
      replace: "replaceQuery",
      isRegex: false,
      matchCase: true,
      matchWholeWord: false,
      preserveCase: false,
      includeGlobs: [],
      excludeGlobs: [],
      useIgnoreFiles: true,
      useExcludeSettings: true,
      onlyOpenEditors: false,
      openEditorPaths: [],
      maxFiles: 50,
      maxMatchesPerFile: 20,
    });

    const preview = await previewSearchSessionFile(rootDir, session.sessionId, "src/app.ts");

    expect(preview).toMatchObject({
      kind: "search-replace-file-diff",
      path: "src/app.ts",
      originalContent: "const query = queryValue;\n",
      modifiedContent: "const replaceQuery = replaceQueryValue;\n",
    });
  });

  it("applies a single match without replacing the rest of the file", async () => {
    await writeFile(join(rootDir, "src", "app.ts"), "query query\n");

    const session = await createSearchSession(rootDir, {
      query: "query",
      replace: "replaceQuery",
      isRegex: false,
      matchCase: true,
      matchWholeWord: false,
      preserveCase: false,
      includeGlobs: [],
      excludeGlobs: [],
      useIgnoreFiles: true,
      useExcludeSettings: true,
      onlyOpenEditors: false,
      openEditorPaths: [],
      maxFiles: 50,
      maxMatchesPerFile: 20,
    });

    const matchId = session.result.files[0]?.matches[0]?.id;
    expect(matchId).toBeTruthy();

    const result = await applySearchSession(rootDir, session.sessionId, {
      kind: "match",
      path: "src/app.ts",
      matchId: matchId!,
    });

    expect(result).toMatchObject({
      status: "ok",
      appliedFileCount: 1,
      results: [{ path: "src/app.ts", status: "applied", replacedMatchCount: 1 }],
    });
  });

  it("reports partial success when a file conflicts after the session snapshot", async () => {
    await writeFile(join(rootDir, "src", "safe.ts"), "query\n");
    await writeFile(join(rootDir, "src", "conflict.ts"), "query\n");

    const session = await createSearchSession(rootDir, {
      query: "query",
      replace: "replaceQuery",
      isRegex: false,
      matchCase: true,
      matchWholeWord: false,
      preserveCase: false,
      includeGlobs: [],
      excludeGlobs: [],
      useIgnoreFiles: true,
      useExcludeSettings: true,
      onlyOpenEditors: false,
      openEditorPaths: [],
      maxFiles: 50,
      maxMatchesPerFile: 20,
    });

    await writeFile(join(rootDir, "src", "conflict.ts"), "changed elsewhere\n");

    const result = await applySearchSession(rootDir, session.sessionId, { kind: "all" });

    expect(result).toMatchObject({
      status: "partial",
      appliedFileCount: 1,
      conflictFileCount: 1,
    });
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/safe.ts", status: "applied" }),
        expect.objectContaining({ path: "src/conflict.ts", status: "conflict" }),
      ])
    );
  });

  it("returns stale_session for unknown sessions", async () => {
    const result = await applySearchSession(rootDir, "missing-session", { kind: "all" });

    expect(result).toMatchObject({
      sessionId: "missing-session",
      status: "stale_session",
    });
  });
});
