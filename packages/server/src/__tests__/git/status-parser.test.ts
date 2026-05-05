/**
 * Tests for git status parser.
 */

import { describe, expect, it } from "vitest";
import { parseStatus } from "../../git/status-parser.js";

describe("parseStatus", () => {
  it("should parse empty status", () => {
    const status = parseStatus("");
    expect(status.branch).toBe("");
    expect(status.headSha).toBeUndefined();
    expect(status.headShortSha).toBeUndefined();
    expect(status.headSubject).toBeUndefined();
    expect(status.staged).toHaveLength(0);
    expect(status.modified).toHaveLength(0);
    expect(status.untracked).toHaveLength(0);
    expect(status.deleted).toHaveLength(0);
  });

  it("should parse branch name", () => {
    const porcelain = `# branch.head main
# branch.oid abc123`;
    const status = parseStatus(porcelain);
    expect(status.branch).toBe("main");
    expect(status.headSha).toBe("abc123");
    expect(status.headShortSha).toBe("abc123");
  });

  it("should parse ahead/behind counts", () => {
    const porcelain = `# branch.head main
# branch.ab +2 -3`;
    const status = parseStatus(porcelain);
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(3);
  });

  it("should parse untracked files", () => {
    const porcelain = `# branch.head main
? file1.txt
? file2.txt`;
    const status = parseStatus(porcelain);
    expect(status.untracked).toHaveLength(2);
    expect(status.untracked[0].path).toBe("file1.txt");
    expect(status.untracked[1].path).toBe("file2.txt");
  });

  it("should parse modified files", () => {
    const porcelain = `# branch.head main
1 .M N... 100644 100644 100644 abc123 abc123 file.txt`;
    const status = parseStatus(porcelain);
    expect(status.modified).toHaveLength(1);
    expect(status.modified[0].path).toBe("file.txt");
  });

  it("should parse staged files", () => {
    const porcelain = `# branch.head main
1 M. N... 100644 100644 100644 abc123 abc123 file.txt`;
    const status = parseStatus(porcelain);
    expect(status.staged).toHaveLength(1);
    expect(status.staged[0].path).toBe("file.txt");
  });

  it("should parse unstaged deleted files", () => {
    const porcelain = `# branch.head main
1 .D N... 100644 100644 000000 abc123 abc123 file.txt`;
    const status = parseStatus(porcelain);
    expect(status.deleted).toHaveLength(1);
    expect(status.deleted[0].path).toBe("file.txt");
  });

  it("should treat staged deletions as staged changes", () => {
    const porcelain = `# branch.head main
1 D. N... 100644 000000 000000 abc123 abc123 file.txt`;
    const status = parseStatus(porcelain);
    expect(status.staged).toHaveLength(1);
    expect(status.staged[0].path).toBe("file.txt");
    expect(status.deleted).toHaveLength(0);
  });

  it("should parse renamed files", () => {
    const porcelain = `# branch.head main
2 R. N... 100644 100644 100644 abc123 abc123 R100 new.txt\told.txt`;
    const status = parseStatus(porcelain);
    expect(status.staged).toHaveLength(1);
    expect(status.staged[0].path).toBe("new.txt");
    expect(status.staged[0].oldPath).toBe("old.txt");
  });

  it("should parse NUL-delimited records with raw paths", () => {
    const porcelain = [
      "# branch.head main",
      "# branch.ab +1 -2",
      "1 .D N... 100644 100644 000000 abc123 abc123 docs/验收报告/phase 1/a b.txt",
      "? docs/验收报告/phase 1/c d.txt",
      "",
    ].join("\0");
    const status = parseStatus(porcelain);

    expect(status.branch).toBe("main");
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(2);
    expect(status.deleted).toEqual([{ path: "docs/验收报告/phase 1/a b.txt" }]);
    expect(status.untracked).toEqual([{ path: "docs/验收报告/phase 1/c d.txt" }]);
  });

  it("should parse NUL-delimited renamed files with spaces and non-ascii paths", () => {
    const porcelain = [
      "# branch.head main",
      "2 R. N... 100644 100644 100644 abc123 abc123 R100 docs/验收报告/phase 1/c d.txt",
      "docs/验收报告/phase 1/a b.txt",
      "",
    ].join("\0");
    const status = parseStatus(porcelain);

    expect(status.staged).toEqual([
      {
        path: "docs/验收报告/phase 1/c d.txt",
        oldPath: "docs/验收报告/phase 1/a b.txt",
      },
    ]);
  });

  it("should handle complex status", () => {
    const porcelain = `# branch.oid abc123
# branch.head main
# branch.upstream origin/main
# branch.ab +1 -2
1 M. N... 100644 100644 100644 def def staged.txt
1 .M N... 100644 100644 100644 abc abc modified.txt
? untracked.txt`;
    const status = parseStatus(porcelain);

    expect(status.branch).toBe("main");
    expect(status.headSha).toBe("abc123");
    expect(status.headShortSha).toBe("abc123");
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(2);
    expect(status.staged).toHaveLength(1);
    expect(status.modified).toHaveLength(1);
    expect(status.untracked).toHaveLength(1);
  });

  it("ignores synthetic initial branch oid before the first commit", () => {
    const porcelain = `# branch.oid (initial)
# branch.head main`;
    const status = parseStatus(porcelain);

    expect(status.headSha).toBeUndefined();
    expect(status.headShortSha).toBeUndefined();
  });
});
