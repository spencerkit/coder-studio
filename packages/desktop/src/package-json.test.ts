import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop package manifest", () => {
  it("does not declare the server workspace package as a desktop app runtime dependency", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(import.meta.dirname, "..", "package.json"), "utf-8")
    ) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies).not.toHaveProperty("@coder-studio/server");
  });

  it("declares explicit packaged app icons from the shared web assets", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(import.meta.dirname, "..", "package.json"), "utf-8")
    ) as {
      build?: {
        icon?: string;
        win?: {
          icon?: string;
        };
      };
    };

    expect(packageJson.build?.icon).toBe("../web/public/favicon.png");
    expect(packageJson.build?.win?.icon).toBe("../web/public/favicon.ico");
  });
});
