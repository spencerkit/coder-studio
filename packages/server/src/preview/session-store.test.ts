import { describe, expect, it } from "vitest";
import { PreviewSessionStore } from "./session-store.js";

describe("PreviewSessionStore", () => {
  it("creates sessions at revision 1 and increments revisions on update", () => {
    const store = new PreviewSessionStore();

    const created = store.create({
      workspaceId: "ws-1",
      entryPath: "docs/guide/index.html",
      kind: "html",
      content: "<h1>one</h1>",
    });

    expect(created.revision).toBe(1);
    expect(created.allowScripts).toBe(false);

    const updated = store.update(created.id, {
      content: "<h1>two</h1>",
    });

    expect(updated).toMatchObject({
      id: created.id,
      revision: 2,
      content: "<h1>two</h1>",
    });
  });

  it("deletes sessions and treats missing ids as misses", () => {
    const store = new PreviewSessionStore();
    const created = store.create({
      workspaceId: "ws-1",
      entryPath: "README.md",
      kind: "markdown",
      content: "# hi",
    });

    expect(store.delete(created.id)).toBe(true);
    expect(store.get(created.id)).toBeNull();
    expect(store.update("missing", { content: "ignored" })).toBeNull();
    expect(store.delete("missing")).toBe(false);
  });

  it("cleans up expired sessions", () => {
    const store = new PreviewSessionStore();
    const created = store.create({
      workspaceId: "ws-1",
      entryPath: "README.md",
      kind: "markdown",
      content: "# hi",
    });

    const removed = store.cleanupExpiredSessions(
      created.updatedAt + 31 * 60 * 1000,
      30 * 60 * 1000
    );

    expect(removed).toBe(1);
    expect(store.get(created.id)).toBeNull();
  });
});
