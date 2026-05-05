import { describe, expect, it } from "vitest";
import {
  assertSupportedNodeVersion,
  isNodeVersionSupported,
  MINIMUM_NODE_VERSION,
} from "./node-version.js";

describe("node-version", () => {
  it("accepts supported Node.js versions", () => {
    expect(isNodeVersionSupported(MINIMUM_NODE_VERSION)).toBe(true);
    expect(isNodeVersionSupported("25.9.0")).toBe(true);
  });

  it("rejects unsupported Node.js versions", () => {
    expect(isNodeVersionSupported("22.4.0")).toBe(false);
    expect(isNodeVersionSupported("23.9.9")).toBe(false);
  });

  it("throws a clear error for unsupported Node.js versions", () => {
    expect(() => assertSupportedNodeVersion("22.4.0")).toThrow(/requires Node\.js >=24\.0\.0/);
    expect(() => assertSupportedNodeVersion("22.4.0")).toThrow(/node:sqlite/);
  });

  it("does not throw for supported Node.js versions", () => {
    expect(() => assertSupportedNodeVersion("25.9.0")).not.toThrow();
  });
});
