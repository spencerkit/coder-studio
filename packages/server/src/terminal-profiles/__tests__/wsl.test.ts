import { describe, expect, it } from "vitest";
import { decodeWindowsConsoleOutput } from "../wsl.js";

describe("decodeWindowsConsoleOutput", () => {
  it("decodes UTF-16 LE wsl distro list output without BOM", () => {
    const buffer = Buffer.from("Ubuntu-24.04\r\n", "utf16le");

    expect(decodeWindowsConsoleOutput(buffer)).toBe("Ubuntu-24.04\r\n");
  });

  it("decodes UTF-16 LE output with BOM", () => {
    const body = Buffer.from("Ubuntu-24.04\r\n", "utf16le");
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), body]);

    expect(decodeWindowsConsoleOutput(buffer)).toBe("Ubuntu-24.04\r\n");
  });

  it("keeps UTF-8 output unchanged", () => {
    const buffer = Buffer.from("Ubuntu-24.04\r\n", "utf8");

    expect(decodeWindowsConsoleOutput(buffer)).toBe("Ubuntu-24.04\r\n");
  });
});
