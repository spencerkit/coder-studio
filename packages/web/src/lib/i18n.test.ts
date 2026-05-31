// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import zh from "../locales/zh.json";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(child, nextPrefix);
  });
}

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "locales" || entry.name === "__tests__" || entry.name === "test-utils") {
        return [];
      }

      return collectSourceFiles(fullPath);
    }

    if (!/\.(ts|tsx)$/.test(entry.name) || /\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
      return [];
    }

    return [fullPath];
  });
}

describe("i18n coverage", () => {
  it("labels the open editor section as open files in user-facing copy", () => {
    expect(zh.workspace.sidebar.open_editors).toBe("打开的文件");
    expect(zh.workspace.open_editors.expand_label).toBe("展开打开的文件");
    expect(zh.workspace.open_editors.collapse_label).toBe("收起打开的文件");
    expect(en.workspace.sidebar.open_editors).toBe("Open Files");
    expect(en.workspace.open_editors.expand_label).toBe("Expand Open Files");
    expect(en.workspace.open_editors.collapse_label).toBe("Collapse Open Files");
  });

  it("resolves every static translation key used in source files", () => {
    const localeKeys = new Set(flattenKeys(zh));
    const sourceRoot = path.resolve(__dirname, "..");
    const translationCall = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
    const missing: Array<{ file: string; line: number; key: string }> = [];

    for (const file of collectSourceFiles(sourceRoot)) {
      const content = fs.readFileSync(file, "utf8");
      let match: RegExpExecArray | null;

      while ((match = translationCall.exec(content)) !== null) {
        const key = match[2];

        if (localeKeys.has(key)) {
          continue;
        }

        missing.push({
          file: path.relative(process.cwd(), file),
          line: content.slice(0, match.index).split("\n").length,
          key,
        });
      }
    }

    expect(missing).toEqual([]);
  });
});
