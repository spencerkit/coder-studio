import { describe, expect, it } from "vitest";
import { formatTokenMetric } from "./format";

describe("formatTokenMetric", () => {
  it("uses compact M and B units for large token counts", () => {
    expect(formatTokenMetric(undefined)).toBe("0");
    expect(formatTokenMetric(999_999)).toBe("999,999");
    expect(formatTokenMetric(1_000_000)).toBe("1M");
    expect(formatTokenMetric(12_840_000)).toBe("12.84M");
    expect(formatTokenMetric(1_000_000_000)).toBe("1B");
    expect(formatTokenMetric(10_637_520_420)).toBe("10.64B");
  });
});
