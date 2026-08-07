import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDesktopReleaseCommand, parseUpdaterMetadata } from "./desktop-release-artifacts.js";

describe("desktop-release-artifacts", () => {
  it("parses deterministic staging and validation commands", () => {
    expect(
      parseDesktopReleaseCommand([
        "stage",
        "--directory",
        "release/desktop-release-windows",
        "--components",
        "desktop win-runtime desktop",
      ])
    ).toEqual({
      action: "stage",
      directory: resolve("release/desktop-release-windows"),
      components: ["desktop", "win-runtime"],
    });
    expect(
      parseDesktopReleaseCommand([
        "validate",
        "--directory",
        "release/desktop-release-linux",
        "--components",
        "wsl-engine,wsl-runtime",
        "--allow-unsigned",
      ])
    ).toMatchObject({
      action: "validate",
      directory: resolve("release/desktop-release-linux"),
      components: ["wsl-engine", "wsl-runtime"],
      allowUnsigned: true,
    });
  });

  it("reads electron-updater metadata and rejects unsafe installer paths", () => {
    expect(
      parseUpdaterMetadata(
        [
          "version: 0.1.0",
          "files:",
          '  - url: "Coder-Studio-Setup-0.1.0.exe"',
          `    sha512: ${Buffer.alloc(64, 7).toString("base64")}`,
          "    size: 1024",
          'path: "Coder-Studio-Setup-0.1.0.exe"',
          `sha512: ${Buffer.alloc(64, 7).toString("base64")}`,
        ].join("\n")
      )
    ).toEqual({
      version: "0.1.0",
      path: "Coder-Studio-Setup-0.1.0.exe",
      sha512: Buffer.alloc(64, 7).toString("base64"),
      size: 1024,
    });
    expect(() =>
      parseUpdaterMetadata(
        [
          "version: 0.1.0",
          "files:",
          "  - url: ../setup.exe",
          `    sha512: ${Buffer.alloc(64).toString("base64")}`,
          "    size: 1024",
          "path: ../setup.exe",
          `sha512: ${Buffer.alloc(64).toString("base64")}`,
        ].join("\n")
      )
    ).toThrow("invalid version or path");
    expect(() =>
      parseUpdaterMetadata(
        [
          "version: 0.1.0",
          "files:",
          "  - url: different.exe",
          `    sha512: ${Buffer.alloc(64).toString("base64")}`,
          "    size: 1024",
          "path: setup.exe",
          `sha512: ${Buffer.alloc(64).toString("base64")}`,
        ].join("\n")
      )
    ).toThrow("invalid SHA-512 or size");
  });

  it("rejects incomplete commands and unknown components", () => {
    expect(() => parseDesktopReleaseCommand(["stage"])).toThrow("--directory is required");
    expect(() =>
      parseDesktopReleaseCommand([
        "stage",
        "--directory",
        "release/bundle",
        "--components",
        "mac-runtime",
      ])
    ).toThrow("--components must contain");
  });
});
