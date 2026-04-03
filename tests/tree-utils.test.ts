import test from "node:test";
import assert from "node:assert/strict";
import { sortTreeNodes } from "../apps/web/src/shared/utils/tree";

test("sortTreeNodes memoizes sorted output for the same input identity and locale", () => {
  const nodes = [
    { name: "b.ts", path: "b.ts", kind: "file" as const },
    {
      name: "src",
      path: "src",
      kind: "dir" as const,
      children: [
        { name: "z.ts", path: "src/z.ts", kind: "file" as const },
        { name: "a.ts", path: "src/a.ts", kind: "file" as const },
      ],
    },
    { name: "a.ts", path: "a.ts", kind: "file" as const },
  ];

  const first = sortTreeNodes(nodes, "en");
  const second = sortTreeNodes(nodes, "en");

  assert.equal(second, first);
  assert.deepEqual(first.map((node) => node.name), ["src", "a.ts", "b.ts"]);
  assert.deepEqual(first[0]?.children?.map((node) => node.name), ["a.ts", "z.ts"]);
});
