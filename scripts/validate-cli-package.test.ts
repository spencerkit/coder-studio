import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { describe, expect, it } from "vitest";
import {
  compareCliPackageArchives,
  parseValidateCliPackageArguments,
  validateCliPackageArchive,
} from "./validate-cli-package.js";

interface PackageFixtureOptions {
  binContent?: string;
  includeTypes?: boolean;
  indexContent?: string;
  packedManifest?: Record<string, unknown>;
  tarMtime?: Date;
}

const sourceManifest = {
  name: "@spencer-kit/coder-studio",
  version: "1.2.3",
  main: "./src/index.ts",
  bin: { "coder-studio": "./src/bin.ts" },
  exports: {
    ".": {
      import: "./src/index.ts",
      types: "./src/index.ts",
    },
  },
  publishConfig: {
    main: "./dist/esm/index.mjs",
    bin: { "coder-studio": "./dist/bin.js" },
    exports: {
      ".": {
        import: "./dist/esm/index.mjs",
        types: "./dist/esm/index.d.ts",
      },
    },
  },
};

const validPackedManifest = {
  name: sourceManifest.name,
  version: sourceManifest.version,
  main: sourceManifest.publishConfig.main,
  bin: sourceManifest.publishConfig.bin,
  exports: sourceManifest.publishConfig.exports,
};

describe("validate-cli-package", () => {
  it("accepts pnpm's forwarded argument separator", () => {
    expect(
      parseValidateCliPackageArguments([
        "--",
        "--tarball",
        "release/cli.tgz",
        "--source-package-json",
        "packages/cli/package.json",
      ])
    ).toEqual({
      sourcePackageJsonPath: "packages/cli/package.json",
      tarballPath: "release/cli.tgz",
    });
  });

  it("parses an optional published tarball comparison", () => {
    expect(
      parseValidateCliPackageArguments([
        "--tarball",
        "release/candidate.tgz",
        "--compare-tarball",
        "release/published.tgz",
        "--source-package-json",
        "packages/cli/package.json",
      ])
    ).toEqual({
      compareTarballPath: "release/published.tgz",
      sourcePackageJsonPath: "packages/cli/package.json",
      tarballPath: "release/candidate.tgz",
    });
  });

  it("accepts package entry fields that resolve to real archive files", async () => {
    const fixture = await createPackageFixture();

    await expect(validateCliPackageArchive(fixture)).resolves.toEqual({
      entryTargets: ["./dist/bin.js", "./dist/esm/index.d.ts", "./dist/esm/index.mjs"],
      name: "@spencer-kit/coder-studio",
      version: "1.2.3",
    });
  });

  it("rejects package entry fields that point to missing archive files", async () => {
    const fixture = await createPackageFixture({ includeTypes: false });

    await expect(validateCliPackageArchive(fixture)).rejects.toThrow(
      'exports...types points to missing file "./dist/esm/index.d.ts"'
    );
  });

  it("rejects an existing bin target without a Node.js shebang", async () => {
    const fixture = await createPackageFixture({ binContent: 'import "./esm/bin.mjs";\n' });

    await expect(validateCliPackageArchive(fixture)).rejects.toThrow(
      'bin.coder-studio is not an executable Node.js entry: "./dist/bin.js"'
    );
  });

  it("rejects a packed manifest that did not apply publishConfig", async () => {
    const fixture = await createPackageFixture({ packedManifest: sourceManifest });

    await expect(validateCliPackageArchive(fixture)).rejects.toThrow(
      "Packed CLI package.json still contains publishConfig"
    );
  });

  it("compares logical package contents instead of tarball metadata", async () => {
    const candidate = await createPackageFixture({ tarMtime: new Date("2026-01-01T00:00:00Z") });
    const published = await createPackageFixture({ tarMtime: new Date("2026-02-01T00:00:00Z") });

    await expect(
      compareCliPackageArchives(candidate.tarballPath, published.tarballPath)
    ).resolves.toBeUndefined();
  });

  it("rejects a published package with different file bytes", async () => {
    const candidate = await createPackageFixture();
    const published = await createPackageFixture({
      indexContent: "export const changed = true;\n",
    });

    await expect(
      compareCliPackageArchives(candidate.tarballPath, published.tarballPath)
    ).rejects.toThrow("package/dist/esm/index.mjs");
  });
});

async function createPackageFixture({
  binContent = '#!/usr/bin/env node\nimport "./esm/index.mjs";\n',
  includeTypes = true,
  indexContent = "export {};\n",
  packedManifest = validPackedManifest,
  tarMtime,
}: PackageFixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "coder-studio-package-validation-"));
  const packageDir = join(root, "package");
  const sourcePackageJsonPath = join(root, "source-package.json");
  const tarballPath = join(root, "package.tgz");

  await mkdir(join(packageDir, "dist", "esm"), { recursive: true });
  await writeFile(sourcePackageJsonPath, JSON.stringify(sourceManifest));
  await writeFile(join(packageDir, "package.json"), JSON.stringify(packedManifest));
  await writeFile(join(packageDir, "dist", "bin.js"), binContent);
  await writeFile(join(packageDir, "dist", "esm", "index.mjs"), indexContent);
  if (includeTypes) {
    await writeFile(join(packageDir, "dist", "esm", "index.d.ts"), "export {};\n");
  }
  await create({ cwd: root, file: tarballPath, gzip: true, mtime: tarMtime }, ["package"]);

  return { sourcePackageJsonPath, tarballPath };
}
