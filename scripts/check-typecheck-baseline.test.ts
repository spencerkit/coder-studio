import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  aggregateTypeDiagnostics,
  compareTypeDiagnostics,
  type TypeDiagnosticEntry,
} from "./check-typecheck-baseline.js";

function entry(overrides: Partial<TypeDiagnosticEntry> = {}): TypeDiagnosticEntry {
  return {
    file: "src/example.ts",
    code: 2322,
    message: "Type 'string' is not assignable to type 'number'.",
    count: 1,
    ...overrides,
  };
}

describe("typecheck diagnostic baseline", () => {
  it("wires type checking into CI and release validation", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts["ci:typecheck"]).toContain("ci:typecheck:strict");
    expect(manifest.scripts["ci:typecheck"]).toContain("ci:typecheck:web");
    expect(manifest.scripts["ci:verify"]).toContain("pnpm ci:typecheck");
    expect(manifest.scripts["ci:release:validate"]).toContain("pnpm ci:verify");
  });

  it("allows known diagnostics and reports resolved debt", () => {
    expect(compareTypeDiagnostics([entry({ count: 2 })], [entry()])).toEqual({
      baselineCount: 2,
      currentCount: 1,
      resolvedCount: 1,
      newDiagnostics: [],
    });
  });

  it("rejects a new diagnostic even when the total count does not increase", () => {
    const result = compareTypeDiagnostics(
      [entry()],
      [entry({ file: "src/other.ts", code: 2339, message: "Property is missing." })]
    );

    expect(result.currentCount).toBe(1);
    expect(result.newDiagnostics).toEqual([
      entry({ file: "src/other.ts", code: 2339, message: "Property is missing." }),
    ]);
  });

  it("normalizes paths and aggregates duplicate diagnostics", () => {
    const diagnostic = {
      file: { fileName: "C:\\repo\\web\\src\\example.ts" },
      code: 7006,
      messageText: "Parameter 'value' implicitly has an 'any' type.",
    } as ts.Diagnostic;

    expect(aggregateTypeDiagnostics([diagnostic, diagnostic], "C:\\repo\\web")).toEqual([
      {
        file: "src/example.ts",
        code: 7006,
        message: "Parameter 'value' implicitly has an 'any' type.",
        count: 2,
      },
    ]);
  });
});
