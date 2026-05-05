import { describe, expect, it } from "vitest";
import { formatTerminalTitle } from "./title-format";

describe("formatTerminalTitle", () => {
  it("labels shell tabs with the actual shell name instead of hardcoded bash", () => {
    expect(
      formatTerminalTitle(
        {
          id: "term-1",
          workspaceId: "ws-1",
          kind: "shell",
          alive: true,
          title: "/bin/zsh",
        },
        0,
        "Shell"
      )
    ).toBe("zsh — 1");
  });
});
