import { describe, expect, it } from "vitest";
import { buildWikiRemote, parsePublishWikiArgs } from "./publish-wiki.js";

describe("publish-wiki", () => {
  it("defaults to a safe dry-run wiki publish flow", () => {
    expect(parsePublishWikiArgs([])).toEqual({
      allowDirty: false,
      message: "docs: update wiki",
      push: false,
      remote: undefined,
      workdir: undefined,
    });
  });

  it("parses explicit wiki publish flags", () => {
    expect(
      parsePublishWikiArgs([
        "--",
        "--push",
        "--allow-dirty",
        "--message",
        "docs: sync wiki",
        "--remote",
        "git@github.com:spencerkit/coder-studio.wiki.git",
        "--workdir",
        "/tmp/coder-studio.wiki",
      ])
    ).toEqual({
      allowDirty: true,
      message: "docs: sync wiki",
      push: true,
      remote: "git@github.com:spencerkit/coder-studio.wiki.git",
      workdir: "/tmp/coder-studio.wiki",
    });
  });

  it("builds the default wiki remote when no override or token is provided", () => {
    expect(buildWikiRemote({ remote: undefined }, {})).toBe(
      "https://github.com/spencerkit/coder-studio.wiki.git"
    );
  });

  it("preserves an explicit wiki remote even when a GitHub token exists", () => {
    expect(
      buildWikiRemote(
        { remote: "git@github.com:spencerkit/coder-studio.wiki.git" },
        { GITHUB_TOKEN: "secret-token" }
      )
    ).toBe("git@github.com:spencerkit/coder-studio.wiki.git");
  });

  it("injects the GitHub token into the default wiki remote when available", () => {
    expect(buildWikiRemote({ remote: undefined }, { GITHUB_TOKEN: "secret-token" })).toBe(
      "https://x-access-token:secret-token@github.com/spencerkit/coder-studio.wiki.git"
    );
  });
});
